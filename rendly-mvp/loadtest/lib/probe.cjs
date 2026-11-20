// Preloaded into each service process (`node -r probe.cjs`) during a load test. Once a second it
// appends CPU, memory and event-loop health to LT_PROBE_FILE as one JSON line. It changes no
// service behaviour and is never loaded outside the load-test harness.
const fs = require("node:fs");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");

const file = process.env.LT_PROBE_FILE;
if (file) {
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let lastCpu = process.cpuUsage();
  let lastAt = process.hrtime.bigint();
  let lastElu = performance.eventLoopUtilization();
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage(lastCpu);
    const wallUs = Number(now - lastAt) / 1000;
    const elu = performance.eventLoopUtilization(lastElu);
    const mem = process.memoryUsage();
    const line = {
      t: Date.now(),
      cpu: +(((cpu.user + cpu.system) / wallUs) * 100).toFixed(1),
      rssMb: +(mem.rss / 1048576).toFixed(1),
      heapMb: +(mem.heapUsed / 1048576).toFixed(1),
      elu: +elu.utilization.toFixed(3),
      lagP99Ms: +(lag.percentile(99) / 1e6).toFixed(1),
      lagMaxMs: +(lag.max / 1e6).toFixed(1),
      handles: typeof process.getActiveResourcesInfo === "function" ? process.getActiveResourcesInfo().length : null,
    };
    lag.reset();
    lastCpu = process.cpuUsage();
    lastAt = now;
    lastElu = performance.eventLoopUtilization();
    try {
      fs.appendFileSync(file, JSON.stringify(line) + "\n");
    } catch {
      // Probe output is best-effort; never let it affect the service.
    }
  }, 1000);
  timer.unref();
}

// Optional CPU profile: LT_CPU_PROF="startSec:durationSec" writes <probe file>.cpuprofile.
if (process.env.LT_CPU_PROF && process.env.LT_PROBE_FILE) {
  const [startSec, durSec] = process.env.LT_CPU_PROF.split(":").map(Number);
  const inspector = require("node:inspector");
  const session = new inspector.Session();
  session.connect();
  setTimeout(() => {
    session.post("Profiler.enable", () =>
      session.post("Profiler.start", () =>
        setTimeout(() => {
          session.post("Profiler.stop", (err, res) => {
            if (err) return console.error("[probe] cpu profile failed:", err.message);
            try {
              require("node:fs").writeFileSync(process.env.LT_PROBE_FILE + ".cpuprofile", JSON.stringify(res.profile));
            } catch (e) {
              console.error("[probe] cpu profile write failed:", e.message);
            }
          });
        }, durSec * 1000).unref()
      )
    );
  }, startSec * 1000).unref();
}
