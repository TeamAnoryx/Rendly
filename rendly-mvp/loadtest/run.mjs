#!/usr/bin/env node
// Rendly real-time load test runner (LOCAL ONLY).
//
//   node loadtest/run.mjs --feature mixed --users 100,500,1000,2000 --ramp 30 --hold 60 [--background]
//
// For each concurrency level it starts a fresh local stack (mock Supabase + auth-service +
// chat-service), forks load-generator workers, collects client metrics, server CPU / memory /
// event-loop samples and database query counts, then checks them against THRESHOLDS and writes
// loadtest/results/<run>/<feature>-<users>/summary.json.
import { fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Metrics, summarise } from "./lib/metrics.mjs";
import { startStack, stopStack, PORTS } from "./lib/stack.mjs";
import { HUDDLE_SIZE } from "./lib/ids.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function args() {
  const a = process.argv.slice(2);
  const get = (k, d) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 && a[i + 1] !== undefined ? a[i + 1] : d;
  };
  return {
    feature: get("feature", "mixed"),
    levels: get("users", "100").split(",").map(Number).filter((n) => n > 0),
    rampS: Number(get("ramp", 30)),
    holdS: Number(get("hold", 60)),
    workers: Number(get("workers", 4)),
    dbLatencyMs: Number(get("db-latency", 15)),
    dbMax: Number(get("db-max", 0)),
    run: get("run", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)),
    keepGoing: a.includes("--keep-going"),
    background: a.includes("--background"),
    authWorkers: Number(get("auth-workers", 1)),
    websocketOnly: get("transport", "default") === "websocket",
  };
}

/** Pass/fail limits. Latencies are client-observed p95 in ms on a local network. */
const THRESHOLDS = {
  connectSuccess: 0.995, // share of sockets that connect
  connectP95: 2000,
  relayP95: 300, // signaling / chat relays between peers
  ackP95: 1000, // acked socket events (some read the database)
  restP95: 1000,
  errorRate: 0.01, // per operation
  flowSuccess: 0.99, // a call / match / huddle reaching "connected"
  unexpectedDisconnects: 0.005, // per socket
  serverLagP99Ms: 200, // event-loop delay p99 in any 1 s sample
  serverCpuPct: 90, // one Node process ~= one core; sustained > 90% = saturated
  serverRssMb: 1500,
};

/** Split N users into units. Huddles take ids from 0 (6 per group); pairs follow, even-aligned. */
function planUnits(feature, users) {
  const mix = { huddle: 0, spark: 0, whisper: 0 };
  if (feature === "mixed") {
    mix.huddle = Math.floor(users / 3 / HUDDLE_SIZE);
    mix.spark = Math.floor(users / 3 / 2);
    mix.whisper = Math.floor((users - mix.huddle * HUDDLE_SIZE - mix.spark * 2) / 2);
  } else {
    mix[feature] = Math.floor(users / (feature === "huddle" ? HUDDLE_SIZE : 2));
  }
  const units = [];
  for (let g = 0; g < mix.huddle; g++) units.push({ type: "huddle", base: g });
  let next = mix.huddle * HUDDLE_SIZE;
  for (let k = 0; k < mix.spark; k++, next += 2) units.push({ type: "spark", base: next });
  for (let k = 0; k < mix.whisper; k++, next += 2) units.push({ type: "whisper", base: next });
  // Shuffle deterministically so every feature ramps up at the same time.
  const key = (u) => ((u.type.length * 131 + u.base) * 7919) % 1009;
  units.sort((x, y) => key(x) - key(y));
  units.forEach((u, i) => (u.ordinal = i));
  return { units, totalUsers: next, mix };
}

function readProbe(file, from, to) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    console.warn(`  probe file unreadable (${file}): ${err.message}`);
    return null;
  }
  const rows = [];
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try {
      rows.push(JSON.parse(l));
    } catch {
      // a line cut off when the service was stopped mid-write
    }
  }
  const win = rows.filter((r) => r.t >= from && r.t <= to);
  if (!win.length) return null;
  const max = (k) => Math.max(...win.map((r) => r[k] ?? 0));
  const avg = (k) => +(win.reduce((s, r) => s + (r[k] ?? 0), 0) / win.length).toFixed(1);
  return {
    samples: win.length, cpuAvg: avg("cpu"), cpuMax: max("cpu"), rssMaxMb: max("rssMb"),
    heapMaxMb: max("heapMb"), eluAvg: avg("elu"), lagP99MaxMs: max("lagP99Ms"), lagMaxMs: max("lagMaxMs"),
  };
}

function evaluate(sum, servers, totalSockets, peakConnected) {
  const T = THRESHOLDS;
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const c = sum.connect ?? { ok: 0, p95: null };
  add("connect success", c.ok / Math.max(1, totalSockets) >= T.connectSuccess, `${c.ok}/${totalSockets}`);
  add("connect p95", (c.p95 ?? Infinity) <= T.connectP95, `${c.p95} ms`);
  add("peak concurrent sockets", peakConnected >= totalSockets * T.connectSuccess, `${peakConnected}/${totalSockets}`);
  for (const [name, s] of Object.entries(sum)) {
    if (["connect", "reconnect", "unexpected_disconnect", "reconnect_error"].includes(name)) continue;
    if (name.startsWith("flow_")) {
      add(`${name} success`, s.ok / Math.max(1, s.n) >= T.flowSuccess, `${s.ok}/${s.n}`);
      continue;
    }
    const limit = /relay|ring/.test(name) ? T.relayP95 : name.startsWith("rest_") ? T.restP95 : T.ackP95;
    if (s.p95 !== null) add(`${name} p95`, s.p95 <= limit, `${s.p95} ms (limit ${limit})`);
    const why = s.errors ? ` ${JSON.stringify(s.reasons)}` : "";
    add(`${name} errors`, s.errorRate <= T.errorRate, `${(s.errorRate * 100).toFixed(2)}%${why}`);
  }
  const drops = sum.unexpected_disconnect?.errors ?? 0;
  const dropWhy = drops ? ` ${JSON.stringify(sum.unexpected_disconnect.reasons)}` : "";
  add("unexpected disconnects", drops / Math.max(1, totalSockets) <= T.unexpectedDisconnects, `${drops}${dropWhy}`);
  for (const [svc, p] of Object.entries(servers)) {
    if (!p) continue;
    add(`${svc} event-loop p99`, p.lagP99MaxMs <= T.serverLagP99Ms, `${p.lagP99MaxMs} ms`);
    add(`${svc} CPU`, p.cpuMax <= T.serverCpuPct, `avg ${p.cpuAvg}% max ${p.cpuMax}%`);
    add(`${svc} RSS`, p.rssMaxMb <= T.serverRssMb, `${p.rssMaxMb} MB`);
  }
  return checks;
}

function runWorkers(shares, base, connected) {
  return Promise.all(
    shares.map(
      (share, w) =>
        new Promise((resolve) => {
          if (!share.length) return resolve(null);
          const child = fork(path.join(here, "lib", "worker.mjs"), [], {
            stdio: ["ignore", "inherit", "inherit", "ipc"],
            execArgv: ["--max-old-space-size=1024"],
          });
          let result = null;
          child.on("message", (msg) => {
            if (msg.type === "progress") connected[w] = msg.connected;
            if (msg.type === "done") result = msg;
          });
          child.on("exit", () => resolve(result));
          child.send({ type: "start", config: { ...base, units: share } });
        })
    )
  );
}

async function runLevel(opts, users) {
  const label = `${opts.feature}${opts.background ? "-bg" : ""}${opts.websocketOnly ? "-ws" : ""}${opts.authWorkers > 1 ? `-auth${opts.authWorkers}` : ""}-${users}`;
  const outDir = path.join(here, "results", opts.run, label);
  const { units, totalUsers, mix } = planUnits(opts.feature, users);
  console.log(`\n=== ${label}: ${totalUsers} virtual users ${JSON.stringify(mix)}, ramp ${opts.rampS}s, hold ${opts.holdS}s ===`);
  const stack = await startStack({ outDir, dbLatencyMs: opts.dbLatencyMs, dbMaxConcurrent: opts.dbMax, authWorkers: opts.authWorkers });
  const startAt = Date.now() + 3000;
  const rampMs = opts.rampS * 1000;
  const holdMs = opts.holdS * 1000;
  const shares = Array.from({ length: opts.workers }, () => []);
  units.forEach((u, i) => shares[i % opts.workers].push(u));
  const connected = new Array(opts.workers).fill(0);
  const ticker = setInterval(() => {
    const t = Math.round((Date.now() - startAt) / 1000);
    console.log(`  t=${t}s connected=${connected.reduce((a, b) => a + b, 0)}`);
  }, 10_000);
  let results;
  let db = { total: 0, byKey: {}, elapsedMs: 1, peakInFlight: 0, peakQueued: 0 };
  try {
    results = await runWorkers(shares, {
      totalUnits: units.length, startAt, rampMs, holdMs, background: opts.background, websocketOnly: opts.websocketOnly,
      chatUrl: `http://127.0.0.1:${PORTS.chat}`, authUrl: `http://127.0.0.1:${PORTS.auth}`,
    }, connected);
    try {
      db = await (await fetch(`http://127.0.0.1:${PORTS.db}/__stats`)).json();
    } catch (err) {
      console.warn(`  could not read mock DB stats: ${err.message}`);
    }
  } finally {
    clearInterval(ticker);
    await stopStack(stack);
  }

  const done = results.filter(Boolean);
  const sum = summarise(Metrics.merge(done.map((r) => r.metrics)));
  const holdTo = startAt + rampMs + holdMs;
  const servers = {
    "auth-service": readProbe(path.join(outDir, "probe-auth.jsonl"), startAt, holdTo),
    "chat-service": readProbe(path.join(outDir, "probe-chat.jsonl"), startAt, holdTo),
  };
  const peakConnected = done.reduce((a, r) => a + r.peakConnected, 0);
  const dbSummary = {
    total: db.total,
    avgQps: +(db.total / (db.elapsedMs / 1000)).toFixed(1),
    peakInFlight: db.peakInFlight,
    peakQueued: db.peakQueued,
    byKey: Object.fromEntries(Object.entries(db.byKey).sort((a, b) => b[1] - a[1])),
  };
  const checks = evaluate(sum, servers, totalUsers, peakConnected);
  const failed = checks.filter((c) => !c.ok);
  const summary = {
    label, users: totalUsers, mix, background: opts.background, rampS: opts.rampS, holdS: opts.holdS, dbLatencyMs: opts.dbLatencyMs,
    workersReported: `${done.length}/${shares.filter((s) => s.length).length}`,
    peakConnected,
    clientLagP99Ms: Math.max(0, ...done.map((r) => r.clientLagP99Ms)),
    pass: failed.length === 0 && done.length === shares.filter((s) => s.length).length,
    failed: failed.map((c) => `${c.name}: ${c.detail}`),
    operations: sum, servers, db: dbSummary, checks,
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(`  peak connected ${peakConnected}/${totalUsers}; workers ${summary.workersReported}; generator loop p99 ${summary.clientLagP99Ms} ms`);
  console.table(Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, { n: v.n, err: v.errors, p50: v.p50, p95: v.p95, p99: v.p99, max: v.max }])));
  for (const [k, v] of Object.entries(servers)) {
    if (v) console.log(`  ${k}: cpu avg ${v.cpuAvg}% max ${v.cpuMax}%, rss max ${v.rssMaxMb} MB, loop p99 max ${v.lagP99MaxMs} ms`);
  }
  console.log(`  db: ${dbSummary.total} queries, ${dbSummary.avgQps}/s avg, peak in-flight ${dbSummary.peakInFlight}`);
  console.log(summary.pass ? `  RESULT ${label}: PASS` : `  RESULT ${label}: FAIL\n    - ${summary.failed.join("\n    - ")}`);
  return summary;
}

async function main() {
  const opts = args();
  if (!["whisper", "spark", "huddle", "mixed"].includes(opts.feature)) throw new Error(`unknown --feature ${opts.feature}`);
  const all = [];
  for (const users of opts.levels) {
    const s = await runLevel(opts, users);
    all.push({ label: s.label, users: s.users, pass: s.pass, failed: s.failed });
    if (!s.pass && !opts.keepGoing) {
      console.log("Stopping the ladder at the first failing level (use --keep-going to continue).");
      break;
    }
  }
  const dir = path.join(here, "results", opts.run);
  fs.writeFileSync(path.join(dir, `ladder-${opts.feature}.json`), JSON.stringify(all, null, 2));
  console.log(`\nResults: ${dir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
