// Starts the local stack for one load-test step: the mock database plus auth-service and
// chat-service (run from source with ts-node, transpile-only). Every database setting is
// forced to the local mock, so no request can reach a hosted Supabase project: the services'
// dotenv calls never override variables that are already set, and DATABASE_URL is blanked so
// chat-service's direct Postgres pool stays off.
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { BACKEND, LT_JWT_SECRET } from "./ids.mjs";
import { startMockSupabase } from "./mock-supabase.mjs";
import { startMockRedis } from "./mock-redis.mjs";

export const PORTS = { db: 54399, auth: 4101, chat: 4102, redis: 6399 };
const PROBE = path.join(path.dirname(fileURLToPath(import.meta.url)), "probe.cjs");

function serviceEnv(probeFile, authWorkers = 1) {
  const dbUrl = `http://127.0.0.1:${PORTS.db}`;
  return {
    ...process.env,
    NODE_ENV: "development",
    // Database: local mock only.
    SUPABASE_URL: dbUrl,
    SUPABASE_SERVICE_ROLE_KEY: "loadtest-dummy-key",
    SUPABASE_SERVICE_KEY: "loadtest-dummy-key",
    SUPABASE_ANON_KEY: "loadtest-dummy-key",
    DATABASE_URL: "",
    SUPABASE_POOLER_HOST: "",
    // auth-service cluster mode shares rate limits through the local mock Redis.
    REDIS_URL: authWorkers > 1 ? `redis://127.0.0.1:${PORTS.redis}` : "",
    AUTH_WORKERS: String(authWorkers),
    // Auth: test-only secret shared with the virtual users.
    JWT_SECRET: LT_JWT_SECRET,
    // Outbound integrations off.
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "",
    VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "",
    TURN_URLS: "", TURN_SHARED_SECRET: "",
    GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", LINKEDIN_CLIENT_ID: "", LINKEDIN_CLIENT_SECRET: "",
    OPENAI_API_KEY: "",
    ALLOWED_ORIGINS: "",
    PORT: "",
    AUTH_SERVICE_PORT: String(PORTS.auth),
    CHAT_SERVICE_PORT: String(PORTS.chat),
    TS_NODE_TRANSPILE_ONLY: "1",
    LT_PROBE_FILE: probeFile,
  };
}

function startService(name, probeFile, logFile, { entry = "src/server.ts", authWorkers = 1 } = {}) {
  const cwd = path.join(BACKEND, "services", name);
  const log = fs.openSync(logFile, "a");
  const child = spawn(
    process.execPath,
    ["--max-old-space-size=2048", "-r", PROBE, "-r", "ts-node/register/transpile-only", entry],
    { cwd, env: serviceEnv(probeFile, authWorkers), stdio: ["ignore", log, log], windowsHide: true }
  );
  child.on("error", (err) => fs.appendFileSync(logFile, `[loadtest] failed to start ${name}: ${err.message}\n`));
  child.on("exit", () => fs.closeSync(log));
  return child;
}

async function waitHealthy(port, child, ms = 180_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`service on :${port} exited with code ${child.exitCode}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`service on :${port} did not become healthy`);
}

/** Start mock DB + both services; resolves once both answer /health. */
export async function startStack({ outDir, dbLatencyMs = 15, dbMaxConcurrent = 0, authWorkers = 1 }) {
  fs.mkdirSync(outDir, { recursive: true });
  const db = await startMockSupabase({ port: PORTS.db, latencyMs: dbLatencyMs, maxConcurrent: dbMaxConcurrent });
  const redis = authWorkers > 1 ? await startMockRedis({ port: PORTS.redis }) : null;
  const authEntry = authWorkers > 1 ? { entry: "src/cluster.ts", authWorkers } : {};
  const procs = {
    auth: startService("auth-service", path.join(outDir, "probe-auth.jsonl"), path.join(outDir, "auth.log"), authEntry),
    chat: startService("chat-service", path.join(outDir, "probe-chat.jsonl"), path.join(outDir, "chat.log")),
  };
  try {
    await Promise.all([waitHealthy(PORTS.auth, procs.auth), waitHealthy(PORTS.chat, procs.chat)]);
  } catch (err) {
    await stopStack({ db, procs, redis });
    throw err;
  }
  return { db, procs, redis };
}

export async function stopStack({ db, procs, redis }) {
  for (const p of Object.values(procs)) if (p.exitCode === null) p.kill();
  await new Promise((r) => setTimeout(r, 800));
  db.server.closeAllConnections?.();
  await new Promise((r) => db.server.close(() => r()));
  // Lingering client sockets would keep close() pending; don't wait on them past 2 s.
  if (redis) await Promise.race([new Promise((r) => redis.close(() => r())), new Promise((r) => setTimeout(r, 2000))]);
}
