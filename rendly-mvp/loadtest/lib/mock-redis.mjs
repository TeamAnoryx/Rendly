// Minimal Redis stand-in (RESP2 over TCP on 127.0.0.1) for load tests when no Redis server is
// available. Supports only what auth-service's shared-state.ts sends: EVAL (its rate-limit
// increment script), DECR, DEL, GET, SET ... PX, SUBSCRIBE/PUBLISH (user cache invalidation), plus PING/HELLO/CLIENT/SELECT handshakes.
import net from "node:net";

const store = new Map(); // key -> { value: string, expiresAt: number | null }
const channels = new Map(); // channel -> Set<socket>

function live(key) {
  const e = store.get(key);
  if (!e) return null;
  if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return e;
}

const bulk = (s) => (s === null ? "$-1\r\n" : `$${Buffer.byteLength(s)}\r\n${s}\r\n`);
const int = (n) => `:${n}\r\n`;
const ok = "+OK\r\n";
const ARR3 = "*3\r\n"; // header of a 3-element array (pub/sub replies)

function run(args, sock) {
  const cmd = String(args[0] ?? "").toUpperCase();
  switch (cmd) {
    case "PING":
      return "+PONG\r\n";
    case "HELLO":
    case "CLIENT":
    case "SELECT":
    case "AUTH":
    case "QUIT":
      return ok;
    case "GET":
      return bulk(live(args[1])?.value ?? null);
    case "SET": {
      const pxAt = args.findIndex((a, i) => i > 2 && String(a).toUpperCase() === "PX");
      store.set(args[1], { value: String(args[2]), expiresAt: pxAt > 0 ? Date.now() + Number(args[pxAt + 1]) : null });
      return ok;
    }
    case "DEL":
      return int(store.delete(args[1]) ? 1 : 0);
    case "DECR": {
      const e = live(args[1]);
      const n = Number(e?.value ?? 0) - 1;
      store.set(args[1], { value: String(n), expiresAt: e?.expiresAt ?? null });
      return int(n);
    }
    case "SUBSCRIBE": {
      let out = "";
      for (const [n, ch] of args.slice(1).entries()) {
        if (!channels.has(ch)) channels.set(ch, new Set());
        channels.get(ch).add(sock);
        out += ARR3 + bulk("subscribe") + bulk(ch) + int(n + 1);
      }
      return out;
    }
    case "PUBLISH": {
      const subs = channels.get(args[1]) ?? new Set();
      const msg = ARR3 + bulk("message") + bulk(args[1]) + bulk(String(args[2]));
      for (const s of subs) if (!s.destroyed) s.write(msg);
      return int(subs.size);
    }
    case "EVAL": {
      // shared-state.ts increment: EVAL script 1 key windowMs
      const key = args[3];
      const windowMs = Number(args[4]);
      let e = live(key);
      if (!e) {
        e = { value: "0", expiresAt: Date.now() + windowMs };
        store.set(key, e);
      }
      e.value = String(Number(e.value) + 1);
      return `*2\r\n${int(Number(e.value))}${int(Math.max(0, e.expiresAt - Date.now()))}`;
    }
    default:
      return `-ERR unsupported command '${cmd}' in loadtest mock\r\n`;
  }
}

/** Parse as many complete RESP arrays as the buffer holds; returns [commands, rest]. */
function parse(buf) {
  const cmds = [];
  let i = 0;
  while (buf[i] === 0x2a) {
    let nl = buf.indexOf("\r\n", i);
    if (nl < 0) break;
    const count = Number(buf.toString("utf8", i + 1, nl));
    let p = nl + 2;
    const args = [];
    let complete = true;
    for (let k = 0; k < count; k++) {
      nl = buf.indexOf("\r\n", p);
      if (nl < 0 || buf[p] !== 0x24) {
        complete = false;
        break;
      }
      const len = Number(buf.toString("utf8", p + 1, nl));
      const start = nl + 2;
      if (buf.length < start + len + 2) {
        complete = false;
        break;
      }
      args.push(buf.toString("utf8", start, start + len));
      p = start + len + 2;
    }
    if (!complete) break;
    cmds.push(args);
    i = p;
  }
  return [cmds, buf.subarray(i)];
}

export function startMockRedis({ port, host = "127.0.0.1" }) {
  const server = net.createServer((sock) => {
    let pending = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const [cmds, rest] = parse(pending);
      pending = rest;
      if (cmds.length) sock.write(cmds.map((c) => run(c, sock)).join(""));
    });
    sock.on("error", () => sock.destroy());
    sock.on("close", () => { for (const subs of channels.values()) subs.delete(sock); });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
