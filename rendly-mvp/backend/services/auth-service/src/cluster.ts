/**
 * Production entry: runs auth-service as several processes sharing one port, so REST traffic
 * uses more than one CPU core. Workers share rate limits and the GitHub code cache through
 * Redis (shared-state.ts); without REDIS_URL it runs a single process, because per-process
 * rate limits would multiply each user's budget.
 *
 * AUTH_WORKERS sets the process count (default: CPU cores, at most 4).
 */
import cluster from "node:cluster";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const MAX_DEFAULT_WORKERS = 4;
const RESTART_DELAY_MS = 1000;

function workerCount(): number {
  const requested = Number(process.env.AUTH_WORKERS || 0);
  const wanted = requested > 0 ? Math.floor(requested) : Math.min(MAX_DEFAULT_WORKERS, os.availableParallelism());
  if (wanted > 1 && !process.env.REDIS_URL?.trim()) {
    console.warn("[cluster] REDIS_URL is not set: running one auth-service process (rate limits must be shared).");
    return 1;
  }
  return wanted;
}

const count = workerCount();
if (cluster.isPrimary && count > 1) {
  console.log(`[cluster] starting ${count} auth-service workers`);
  for (let i = 0; i < count; i++) cluster.fork();
  cluster.on("exit", (worker, code, signal) => {
    console.error(`[cluster] worker ${worker.process.pid} exited (${signal ?? code}); restarting`);
    setTimeout(() => cluster.fork(), RESTART_DELAY_MS);
  });
} else {
  require("./server");
}
