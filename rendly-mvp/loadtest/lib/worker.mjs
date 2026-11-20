// One load-generator process. The runner forks several and sends each a share of the "units"
// (a Whisper pair, a Spark pair, or a Huddle of 6). Each unit connects its users as Socket.IO
// clients the way the web app does, runs the feature's signaling flow, stays active through
// the hold window, then tears down. Media is peer-to-peer in production, so only signaling and
// REST traffic are simulated.
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Metrics } from "./metrics.mjs";
import { HUDDLE_SIZE, frontendRequire, huddleId, tokenFor, userId } from "./ids.mjs";

const { io } = frontendRequire("socket.io-client");
const m = new Metrics();
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
let cfg;
let connected = 0;
let peakConnected = 0;

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const holdEnd = () => cfg.startAt + cfg.rampMs + cfg.holdMs;
const tokens = new Map();
const tok = (i) => tokens.get(i) ?? tokens.set(i, tokenFor(i)).get(i);

// Relay latency: the sender marks a message id, the receiver finds `lt<id>` in the payload.
let seq = 0;
const pending = new Map();
const tag = (id) => `lt${id}`;
function mark(name, expected = 1) {
  const id = ++seq;
  pending.set(id, { t: performance.now(), name, left: expected });
  return id;
}
function settleTag(str) {
  const match = typeof str === "string" ? str.match(/lt(\d+)/) : null;
  if (!match) return;
  const id = Number(match[1]);
  const p = pending.get(id);
  if (!p) return;
  m.pass(p.name, performance.now() - p.t);
  if (--p.left <= 0) pending.delete(id);
}
const PAD = "a=x-loadtest-padding ".repeat(180); // ~4 KB, a typical SDP size
const sdp = (id) => `v=0\r\no=- ${tag(id)} 2 IN IP4 127.0.0.1\r\ns=-\r\n${PAD}\r\n`;
const cand = (id) =>
  `candidate:842163049 1 udp 1677729535 203.0.113.7 ${40000 + (id % 20000)} typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag ${tag(id)}`;

function connect(i) {
  return new Promise((resolve) => {
    const t = performance.now();
    const s = io(cfg.chatUrl, {
      auth: { token: tok(i) },
      path: "/socket.io",
      forceNew: true, // one engine per virtual user, like separate browsers
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20_000,
      ...(cfg.websocketOnly ? { transports: ["websocket"] } : {}),
    });
    s.ltClosing = false;
    s.ltUp = false;
    let done = false;
    const finish = (sock, reason) => {
      if (done) return;
      done = true;
      if (sock) m.pass("connect", performance.now() - t);
      else {
        m.fail("connect", reason);
        s.ltClosing = true;
        s.close();
      }
      resolve(sock);
    };
    s.on("connect", () => {
      if (!s.ltUp) {
        s.ltUp = true;
        connected += 1;
        peakConnected = Math.max(peakConnected, connected);
      }
      finish(s);
    });
    s.on("connect_error", (e) => (done ? m.fail("reconnect_error", e.message) : finish(null, e.message)));
    s.on("disconnect", (reason) => {
      if (s.ltUp) {
        s.ltUp = false;
        connected -= 1;
      }
      if (!s.ltClosing) m.fail("unexpected_disconnect", reason);
    });
    s.io.on("reconnect", () => m.pass("reconnect"));
    setTimeout(() => finish(null, "timeout 25s"), 25_000);
  });
}

function closeAll(socks) {
  for (const s of socks) {
    if (!s) continue;
    s.ltClosing = true;
    s.close();
  }
}

async function ack(s, ev, payload, name, timeout = 10_000) {
  const t = performance.now();
  try {
    const r = await s.timeout(timeout).emitWithAck(ev, payload);
    if (r && r.ok === false) {
      m.fail(name, r.message ?? "not ok");
      return r;
    }
    m.pass(name, performance.now() - t);
    return r;
  } catch (e) {
    m.fail(name, /timed out/.test(String(e?.message)) ? "ack timeout" : e?.message);
    return null;
  }
}

async function rest(i, path, name, method = "GET") {
  const t = performance.now();
  try {
    const r = await fetch(cfg.authUrl + path, {
      method,
      headers: { authorization: `Bearer ${tok(i)}` },
      signal: AbortSignal.timeout(10_000),
    });
    await r.arrayBuffer();
    const dt = performance.now() - t;
    if (r.ok) m.pass(name, dt);
    else {
      m.time(name, dt);
      m.fail(name, `http ${r.status}`);
    }
  } catch (e) {
    m.fail(name, e?.name === "TimeoutError" ? "timeout" : e?.message);
  }
}

// How often each side of a call sends a chat message (LT_MSG_EVERY_MS, default 6 s).
const MSG_EVERY_MS = Number(process.env.LT_MSG_EVERY_MS) || 6000;

/** POST a Whisper message through chat-service REST; the partner should get message:received. */
async function sendMessage(i, conv, content) {
  const t = performance.now();
  try {
    const r = await fetch(`${cfg.chatUrl}/api/conversations/${conv}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok(i)}`, "content-type": "application/json" },
      body: JSON.stringify({ content, content_type: "text" }),
      signal: AbortSignal.timeout(10_000),
    });
    await r.arrayBuffer();
    const dt = performance.now() - t;
    if (r.ok) m.pass("rest_message_send", dt);
    else {
      m.time("rest_message_send", dt);
      m.fail("rest_message_send", `http ${r.status}`);
    }
  } catch (e) {
    m.fail("rest_message_send", e?.name === "TimeoutError" ? "timeout" : e?.message);
  }
}

/** Run fn every ~intervalMs (jittered) until shortly before the hold window ends. */
async function every(intervalMs, fn) {
  await sleep(rand(0, intervalMs));
  while (Date.now() < holdEnd() - 3000) {
    await fn();
    await sleep(intervalMs * rand(0.85, 1.15));
  }
}

const waitFor = (promise, ms) => Promise.race([promise, sleep(ms).then(() => false)]);

// ---------- feature flows ----------
async function whisperUnit(a) {
  const b = a + 1;
  const conv = `whisper_${userId(a)}_${userId(b)}`;
  const [sa, sb] = await Promise.all([connect(a), connect(b)]);
  if (!sa || !sb) return void (m.fail("flow_whisper", "connect failed"), closeAll([sa, sb]));
  let setupId = 0;
  let established;
  const answered = new Promise((r) => (established = r));
  sb.on("call:incoming", (d) => {
    settleTag(d?.call_log_id);
    setTimeout(() => sb.emit("call:accept", { conversation_id: conv, call_log_id: d?.call_log_id }), 300);
  });
  sa.on("call:accepted", () => {
    settleTag(tag(setupId));
    const id = mark("whisper_webrtc_relay");
    sa.emit("webrtc:offer", { conversation_id: conv, sdp: { type: "offer", sdp: sdp(id) } });
  });
  sb.on("webrtc:offer", (d) => {
    settleTag(d?.sdp?.sdp);
    const id = mark("whisper_webrtc_relay");
    sb.emit("webrtc:answer", { conversation_id: conv, sdp: { type: "answer", sdp: sdp(id) } });
  });
  sa.on("webrtc:answer", (d) => {
    settleTag(d?.sdp?.sdp);
    established(true);
  });
  for (const s of [sa, sb]) s.on("webrtc:ice-candidate", (d) => settleTag(d?.candidate?.candidate));
  for (const s of [sa, sb]) s.on("message:received", (d) => settleTag(JSON.stringify(d ?? null)));
  sb.on("call:ended", (d) => settleTag(d?.call_log_id));

  await sleep(rand(0, 1000));
  const t = performance.now();
  setupId = mark("whisper_call_setup"); // includes the callee's simulated 300 ms to pick up
  const ringId = mark("whisper_call_ring");
  sa.emit("call:start", { conversation_id: conv, call_type: "video", call_log_id: tag(ringId) });
  if (await waitFor(answered, 15_000)) m.pass("flow_whisper", performance.now() - t);
  else m.fail("flow_whisper", "no answer within 15s");
  for (let k = 0; k < 8; k++) {
    for (const s of [sa, sb]) {
      const id = mark("whisper_ice_relay");
      s.emit("webrtc:ice-candidate", { conversation_id: conv, candidate: { candidate: cand(id), sdpMid: "0", sdpMLineIndex: 0 } });
    }
    await sleep(40);
  }
  // Messaging while the call is up: each side sends a chat message every ~MSG_EVERY_MS.
  await Promise.all([a, b].map((i) => every(MSG_EVERY_MS, () => sendMessage(i, conv, `load test ${tag(mark("whisper_message_relay"))}`))));
  await sleep(holdEnd() - Date.now());
  const endId = mark("whisper_end_relay");
  sa.emit("call:end", { conversation_id: conv, call_log_id: tag(endId), status: "completed" });
  await sleep(2000);
  closeAll([sa, sb]);
}

async function sparkUnit(a) {
  const b = a + 1;
  const [sa, sb] = await Promise.all([connect(a), connect(b)]);
  if (!sa || !sb) return void (m.fail("flow_spark", "connect failed"), closeAll([sa, sb]));
  // Searching: the match page polls status (1.5 s at first) until it shows a match.
  await Promise.all(
    [a, b].map(async (i) => {
      for (let k = 0; k < 3; k++) {
        await rest(i, "/api/match/status", "rest_match_status");
        await sleep(1500);
      }
    })
  );
  let established;
  const answered = new Promise((r) => (established = r));
  for (const s of [sa, sb]) {
    s.on("spark:signal", (d) => {
      settleTag(d?.kind === "ice" ? d?.data?.candidate : d?.data?.sdp);
      if (d?.kind === "offer" && s === sb) {
        const id = mark("spark_signal_relay");
        void ack(sb, "spark:signal", { kind: "answer", data: { type: "answer", sdp: sdp(id) } }, "spark_signal_ack");
      }
      if (d?.kind === "answer" && s === sa) established(true);
    });
    s.on("spark:chat", (d) => settleTag(d?.text));
  }
  const t = performance.now();
  const [ja, jb] = await Promise.all([ack(sa, "spark:join", {}, "spark_join"), ack(sb, "spark:join", {}, "spark_join")]);
  if (!ja?.ok || !jb?.ok) {
    m.fail("flow_spark", "join refused");
    return closeAll([sa, sb]);
  }
  const offerId = mark("spark_signal_relay");
  void ack(sa, "spark:signal", { kind: "offer", data: { type: "offer", sdp: sdp(offerId) } }, "spark_signal_ack");
  if (await waitFor(answered, 15_000)) m.pass("flow_spark", performance.now() - t);
  else m.fail("flow_spark", "no answer within 15s");
  for (let k = 0; k < 8; k++) {
    for (const s of [sa, sb]) {
      const id = mark("spark_signal_relay");
      void ack(s, "spark:signal", { kind: "ice", data: { candidate: cand(id), sdpMid: "0", sdpMLineIndex: 0 } }, "spark_signal_ack");
    }
    await sleep(40);
  }
  await Promise.all(
    [sa, sb].map((s) =>
      every(6000, async () => {
        s.emit("spark:typing", { typing: true });
        const id = mark("spark_chat_relay");
        await ack(s, "spark:chat", { text: `hello there ${tag(id)}`, client_id: tag(id) }, "spark_chat_ack");
      })
    )
  );
  await sleep(holdEnd() - Date.now());
  const endT = performance.now();
  const ended = new Promise((r) => sb.once("spark:ended", r));
  sa.emit("spark:leave", { reason: "close" });
  if (await waitFor(ended, 5000)) m.pass("spark_end_relay", performance.now() - endT);
  else m.fail("spark_end_relay", "partner not told within 5s");
  await sleep(1000);
  closeAll([sa, sb]);
}

async function huddleUnit(g) {
  const hid = huddleId(g);
  const ids = Array.from({ length: HUDDLE_SIZE }, (_, k) => g * HUDDLE_SIZE + k);
  const socks = await Promise.all(ids.map(connect));
  if (socks.some((s) => !s)) return void (m.fail("flow_huddle", "connect failed"), closeAll(socks));
  let answers = 0;
  let meshDone;
  const mesh = new Promise((r) => (meshDone = r));
  const pairs = (HUDDLE_SIZE * (HUDDLE_SIZE - 1)) / 2;
  socks.forEach((s) => {
    s.on("huddle:signal", (d) => {
      const data = d?.data ?? {};
      settleTag(data.sdp ?? data.candidate);
      if (data.type === "offer") {
        const id = mark("huddle_signal_relay");
        s.emit("huddle:signal", { huddle_id: hid, room: "main", to: d.from, data: { type: "answer", sdp: sdp(id) } });
      } else if (data.type === "answer" && ++answers === pairs) meshDone(true);
    });
    s.on("huddle:chat", (d) => settleTag(d?.text));
  });
  const t = performance.now();
  const joins = await Promise.all(socks.map((s) => ack(s, "huddle:join", { huddle_id: hid, room: "main" }, "huddle_join")));
  if (joins.some((j) => !j?.ok)) {
    m.fail("flow_huddle", "join refused");
    return closeAll(socks);
  }
  // Full mesh, as the web client does: each pair negotiates one peer connection.
  for (let x = 0; x < HUDDLE_SIZE; x++) {
    for (let y = x + 1; y < HUDDLE_SIZE; y++) {
      const id = mark("huddle_signal_relay");
      socks[x].emit("huddle:signal", { huddle_id: hid, room: "main", to: userId(ids[y]), data: { type: "offer", sdp: sdp(id) } });
    }
  }
  if (await waitFor(mesh, 20_000)) m.pass("flow_huddle", performance.now() - t);
  else m.fail("flow_huddle", `mesh incomplete (${answers}/${pairs} answers)`);
  for (let k = 0; k < 3; k++) {
    for (let x = 0; x < HUDDLE_SIZE; x++) {
      for (let y = 0; y < HUDDLE_SIZE; y++) {
        if (x === y) continue;
        const id = mark("huddle_signal_relay");
        socks[x].emit("huddle:signal", {
          huddle_id: hid, room: "main", to: userId(ids[y]),
          data: { candidate: cand(id), sdpMid: "0", sdpMLineIndex: 0 },
        });
      }
    }
    await sleep(50);
  }
  await Promise.all(
    socks.map((s, k) =>
      Promise.all([
        every(8000, async () => {
          const id = mark("huddle_chat_relay", HUDDLE_SIZE); // the room echoes to the sender too
          s.emit("huddle:chat", { huddle_id: hid, room: "main", text: `hi all ${tag(id)}` });
        }),
        // HuddleRoom: the host polls members every 5 s (waiting list), participants every 20 s.
        every(k === 0 ? 5000 : 20_000, () => rest(ids[k], `/api/huddles/${hid}/members`, "rest_huddle_members")),
        k === 0 ? every(4000, () => ack(s, "huddle:rooms", { huddle_id: hid }, "huddle_rooms")) : null,
      ])
    )
  );
  await sleep(holdEnd() - Date.now());
  for (const s of socks) s.emit("huddle:leave", { huddle_id: hid, room: "main" });
  await sleep(1500);
  closeAll(socks);
}

/**
 * App-wide polls every signed-in tab makes regardless of feature (AppShell points refresh on
 * live pages, useSparkActive, usePresenceHeartbeat). Opt-in with --background.
 */
async function backgroundPolls(users) {
  await sleep(cfg.startAt + cfg.rampMs - Date.now());
  await Promise.all(
    users.map((i) =>
      Promise.all([
        every(10_000, () => rest(i, "/api/points/me", "rest_bg_points")),
        every(10_000, () => rest(i, "/api/match/active", "rest_bg_match_active")),
        every(30_000, () => rest(i, "/api/presence/heartbeat", "rest_bg_heartbeat", "POST")),
      ])
    )
  );
}

function usersOf(u) {
  if (u.type === "huddle") return Array.from({ length: HUDDLE_SIZE }, (_, k) => u.base * HUDDLE_SIZE + k);
  return [u.base, u.base + 1];
}

const RUNNERS = { whisper: whisperUnit, spark: sparkUnit, huddle: huddleUnit };

async function main(config) {
  cfg = config;
  const progress = setInterval(() => process.send?.({ type: "progress", connected }), 5000);
  await Promise.all([
    cfg.background ? backgroundPolls(cfg.units.flatMap(usersOf)) : null,
    ...cfg.units.map(async (u) => {
      await sleep(cfg.startAt + (cfg.rampMs * u.ordinal) / cfg.totalUnits - Date.now());
      try {
        await RUNNERS[u.type](u.base);
      } catch (e) {
        m.fail(`flow_${u.type}`, `crash: ${e?.message}`);
      }
    }),
  ]);
  clearInterval(progress);
  await sleep(1000);
  for (const p of pending.values()) m.fail(p.name, "not delivered");
  process.send?.({
    type: "done",
    metrics: m.toJSON(),
    peakConnected,
    clientLagP99Ms: +(lag.percentile(99) / 1e6).toFixed(1),
    clientLagMaxMs: +(lag.max / 1e6).toFixed(1),
  });
  setTimeout(() => process.exit(0), 300);
}

process.on("message", (msg) => {
  if (msg?.type === "start") void main(msg.config);
});
