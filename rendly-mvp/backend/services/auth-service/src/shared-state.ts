/**
 * State that must be shared when auth-service runs as several processes (see cluster.ts):
 * rate-limit counters and the GitHub sign-in code cache. Backed by Redis when REDIS_URL is
 * set; without it everything stays in this process, as before.
 */
import { createClient } from "redis";
import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | null = null;

/** The shared Redis client, or null when REDIS_URL is not set. Connects lazily, once. */
export function sharedRedis(): RedisClient | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!client) {
    client = createClient({ url });
    client.on("error", (err: unknown) => {
      console.error("[shared-state] Redis error:", err instanceof Error ? err.message : String(err));
    });
    client.connect().catch((err: unknown) => {
      console.error("[shared-state] Redis connect failed:", err instanceof Error ? err.message : String(err));
    });
  }
  return client;
}

/** INCR the window counter, starting its expiry on the first hit; returns [hits, ms left]. */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }`;

/** express-rate-limit store whose counters every auth-service process shares. */
class RedisRateLimitStore implements Store {
  prefix: string;
  private windowMs = 60_000;

  constructor(private readonly redis: RedisClient, name: string) {
    this.prefix = `rl:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const reply = (await this.redis.eval(INCREMENT_SCRIPT, {
      keys: [this.prefix + key],
      arguments: [String(this.windowMs)],
    })) as [number, number];
    return { totalHits: Number(reply[0]), resetTime: new Date(Date.now() + Number(reply[1])) };
  }

  async decrement(key: string): Promise<void> {
    await this.redis.decr(this.prefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}

/**
 * Options to spread into a rateLimit() call: a shared store when Redis is configured. If Redis
 * is unreachable the request is let through (and the error logged) rather than failing.
 */
export function sharedLimiterStore(name: string): Partial<Options> {
  const redis = sharedRedis();
  if (!redis) return {};
  return { store: new RedisRateLimitStore(redis, name), passOnStoreError: true };
}

export type GitHubExchange = { user: object; jwt: string };
const localGitHubCodes = new Map<string, GitHubExchange>();

/** A finished GitHub code exchange (the same code can be retried by the browser), or null. */
export async function getSharedGitHubResult(code: string): Promise<GitHubExchange | null> {
  const local = localGitHubCodes.get(code);
  if (local) return local;
  const redis = sharedRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`gh-code:${code}`);
    return raw ? (JSON.parse(raw) as GitHubExchange) : null;
  } catch (err) {
    console.error("[shared-state] GitHub code lookup failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Remember a finished GitHub code exchange for ttlMs, in this process and in Redis. */
export async function setSharedGitHubResult(code: string, value: GitHubExchange, ttlMs: number): Promise<void> {
  localGitHubCodes.set(code, value);
  setTimeout(() => localGitHubCodes.delete(code), ttlMs).unref();
  const redis = sharedRedis();
  if (!redis) return;
  try {
    await redis.set(`gh-code:${code}`, JSON.stringify(value), { PX: ttlMs });
  } catch (err) {
    console.error("[shared-state] GitHub code save failed:", err instanceof Error ? err.message : String(err));
  }
}

const USER_INVALIDATE_CHANNEL = "auth:user-cache-invalidate";
let subscriber: RedisClient | null = null;

/** Tell every auth-service worker to drop its cached copy of this user. No-op without Redis. */
export function publishUserInvalidation(userId: string): void {
  const redis = sharedRedis();
  if (!redis) return;
  redis.publish(USER_INVALIDATE_CHANNEL, userId).catch((err: unknown) => {
    console.error("[shared-state] user cache invalidation publish failed:", err instanceof Error ? err.message : String(err));
  });
}

/** Run handler(userId) whenever any worker publishes an invalidation. Subscribes once; no-op without Redis. */
export function onUserInvalidation(handler: (userId: string) => void): void {
  const redis = sharedRedis();
  if (!redis || subscriber) return;
  const sub = redis.duplicate();
  subscriber = sub;
  sub.on("error", (err: unknown) => {
    console.error("[shared-state] Redis subscriber error:", err instanceof Error ? err.message : String(err));
  });
  sub
    .connect()
    .then(() => sub.subscribe(USER_INVALIDATE_CHANNEL, (message: string) => handler(message)))
    .catch((err: unknown) => {
      console.error("[shared-state] user cache subscribe failed:", err instanceof Error ? err.message : String(err));
    });
}
