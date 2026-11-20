// Latency samples and outcome counters for one worker, merged by the runner.
export class Metrics {
  constructor() {
    this.samples = {}; // name -> number[] (ms)
    this.ok = {}; // name -> count
    this.err = {}; // name -> { reason: count }
  }
  time(name, ms) {
    (this.samples[name] ??= []).push(ms);
  }
  pass(name, ms) {
    this.ok[name] = (this.ok[name] ?? 0) + 1;
    if (ms !== undefined) this.time(name, ms);
  }
  fail(name, reason) {
    const r = String(reason ?? "error").slice(0, 80);
    const bucket = (this.err[name] ??= {});
    bucket[r] = (bucket[r] ?? 0) + 1;
  }
  toJSON() {
    return { samples: this.samples, ok: this.ok, err: this.err };
  }
  static merge(list) {
    const m = new Metrics();
    for (const x of list) {
      for (const [k, v] of Object.entries(x.samples)) for (const s of v) (m.samples[k] ??= []).push(s);
      for (const [k, v] of Object.entries(x.ok)) m.ok[k] = (m.ok[k] ?? 0) + v;
      for (const [k, v] of Object.entries(x.err)) {
        const b = (m.err[k] ??= {});
        for (const [r, n] of Object.entries(v)) b[r] = (b[r] ?? 0) + n;
      }
    }
    return m;
  }
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/** name -> { n, ok, errors, errorRate, p50, p95, p99, max, reasons } */
export function summarise(m) {
  const names = new Set([...Object.keys(m.samples), ...Object.keys(m.ok), ...Object.keys(m.err)]);
  const out = {};
  for (const name of [...names].sort()) {
    const s = (m.samples[name] ?? []).slice().sort((a, b) => a - b);
    const ok = m.ok[name] ?? 0;
    const errors = Object.values(m.err[name] ?? {}).reduce((a, b) => a + b, 0);
    const r = (x) => (x === null ? null : Math.round(x));
    out[name] = {
      n: ok + errors || s.length,
      ok,
      errors,
      errorRate: ok + errors ? +(errors / (ok + errors)).toFixed(4) : 0,
      p50: r(percentile(s, 50)),
      p95: r(percentile(s, 95)),
      p99: r(percentile(s, 99)),
      max: r(s.length ? s[s.length - 1] : null),
      reasons: m.err[name] ?? {},
    };
  }
  return out;
}
