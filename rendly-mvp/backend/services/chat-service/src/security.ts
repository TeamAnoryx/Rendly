/**
 * Security helpers for chat-service: signing secret, response headers, per-user rate limits,
 * and the pure permission rules for group membership changes and message deletion.
 */
import type express from "express";

const DEV_JWT_SECRET = "dev-secret-change-in-production";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest text message stored, in characters. */
export const MAX_MESSAGE_CHARS = 8000;
/** Most message ids accepted by one delete or unsend call. */
export const MAX_MESSAGE_IDS = 100;

export function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * The JWT signing secret shared with auth-service. In production a missing secret stops the
 * service: a well-known fallback would let anyone sign a valid token for any user.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.JWT_SECRET;
  if (value) return value;
  if (env.NODE_ENV === "production") throw new Error("JWT_SECRET is not set");
  return DEV_JWT_SECRET;
}

/** Baseline response headers for a JSON API (set by hand; no extra dependency). */
export function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.removeHeader("X-Powered-By");
  next();
}

/** Keep only well-formed, distinct message ids, at most MAX_MESSAGE_IDS of them. */
export function sanitizeMessageIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(isUuidString))].slice(0, MAX_MESSAGE_IDS);
}

/**
 * May `actor` remove `target` from a group? Anyone may leave; the creator is never removed;
 * the creator removes anyone else; an admin removes plain members only.
 */
export function canRemoveMember(opts: {
  actorId: string;
  actorRole: string | undefined;
  targetId: string;
  targetRole: string | undefined;
}): boolean {
  if (!opts.actorRole || !opts.targetRole) return false;
  if (opts.targetRole === "creator") return false;
  if (opts.actorId === opts.targetId) return true;
  if (opts.actorRole === "creator") return true;
  return opts.actorRole === "admin" && opts.targetRole === "member";
}

/** Only the creator changes roles, only between admin and member, and never their own. */
export function canSetMemberRole(opts: {
  actorId: string;
  actorRole: string | undefined;
  targetId: string;
  targetRole: string | undefined;
  nextRole: unknown;
}): boolean {
  if (opts.actorRole !== "creator") return false;
  if (!opts.targetRole || opts.targetRole === "creator") return false;
  if (opts.actorId === opts.targetId) return false;
  return opts.nextRole === "admin" || opts.nextRole === "member";
}

/** A group message may be deleted for everyone by its sender, the creator, or an admin. */
export function canDeleteGroupMessage(opts: { actorId: string; actorRole: string | undefined; senderId: string }): boolean {
  if (!opts.actorRole) return false;
  if (opts.senderId === opts.actorId) return true;
  return opts.actorRole === "creator" || opts.actorRole === "admin";
}

/**
 * Sliding-window limiter kept in memory (one chat-service process). `allow(key)` answers false
 * once `max` hits fall inside `windowMs`. Idle keys are swept so the map cannot grow forever.
 */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  let lastSweep = now();
  function sweep(t: number): void {
    if (t - lastSweep < windowMs) return;
    lastSweep = t;
    for (const [key, times] of hits) {
      if (!times.length || t - times[times.length - 1] >= windowMs) hits.delete(key);
    }
  }
  return {
    allow(key: string): boolean {
      const t = now();
      sweep(t);
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      hits.set(key, [...recent, t]);
      return true;
    },
    size(): number {
      return hits.size;
    },
  };
}

type AuthedRequest = express.Request & { currentUser?: { userId: string } };

/** Express middleware: per-user budget (falls back to IP before auth). Mount after requireAuth. */
export function userRateLimit(max: number, windowMs: number): express.RequestHandler {
  const limiter = createRateLimiter(max, windowMs);
  return (req, res, next) => {
    const key = (req as AuthedRequest).currentUser?.userId ?? `ip:${req.ip ?? "unknown"}`;
    if (limiter.allow(key)) {
      next();
      return;
    }
    res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
    res.status(429).json({ message: "You are doing that too fast. Wait a moment and try again." });
  };
}
