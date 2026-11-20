// A minimal PostgREST stand-in on 127.0.0.1 so the services can run under load without
// touching any hosted Supabase project. It answers the queries the real-time paths make
// (users, match_queue, user_blocks, huddle_participants, huddles) with rows for the synthetic
// test users, returns empty results for everything else, adds a configurable latency per
// query, and counts every query so the report can project real database load.
import http from "node:http";
import {
  HUDDLE_SIZE, huddleId, huddleIndex, matchRowId, partnerOf, userId, userIndex,
} from "./ids.mjs";

const json = (res, status, body, headers = {}) => {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(text);
};

/** `user_id=eq.X` style filters -> { user_id: "X" } (eq only; other operators are ignored). */
function eqFilters(params) {
  const out = {};
  for (const [k, v] of params) if (v.startsWith("eq.")) out[k] = v.slice(3);
  return out;
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

function userRow(id) {
  const i = userIndex(id);
  if (i < 0) return null;
  return { id, username: `lt_user_${i}`, email: `lt_user_${i}@loadtest.invalid`, avatar_url: null, points: 1000 };
}

function matchRow(i) {
  return {
    id: matchRowId(i), user_id: userId(i), partner_user_id: userId(partnerOf(i)), status: "matched",
    mode: "video", matched_at: iso(5000), ended_at: null, created_at: iso(10000), intents: [],
    cost: 0, cost_charged: 0, charge_state: "waived", note: null, anonymous: false,
  };
}

function seatRow(g, i) {
  return {
    huddle_id: huddleId(g), user_id: userId(i), role: i % HUDDLE_SIZE === 0 ? "host" : "participant",
    can_speak: true, can_share_screen: false, admitted: true, left_at: null, joined_at: iso(60000),
  };
}

function huddleRow(id) {
  const g = huddleIndex(id);
  if (g < 0) return null;
  return {
    id, title: `Load test huddle ${g}`, created_by: userId(g * HUDDLE_SIZE), allow_self_exit: true,
    cancelled_at: null, ended_at: null, status: "live", max_participants: HUDDLE_SIZE, starts_at: iso(60000),
  };
}

/** Rows for a GET, or null when the table is not modelled (answered with an empty result). */
function rowsFor(table, f) {
  switch (table) {
    case "users": {
      const r = userRow(f.id);
      return r ? [r] : [];
    }
    case "match_queue": {
      const i = userIndex(f.user_id);
      if (i < 0) return [];
      if (f.partner_user_id && userIndex(f.partner_user_id) !== partnerOf(i)) return [];
      return [matchRow(i)];
    }
    case "huddle_participants": {
      const g = huddleIndex(f.huddle_id);
      if (g < 0) return [];
      if (f.user_id) {
        const i = userIndex(f.user_id);
        return i >= g * HUDDLE_SIZE && i < (g + 1) * HUDDLE_SIZE ? [seatRow(g, i)] : [];
      }
      return Array.from({ length: HUDDLE_SIZE }, (_, k) => seatRow(g, g * HUDDLE_SIZE + k));
    }
    case "huddles": {
      const r = huddleRow(f.id);
      return r ? [r] : [];
    }
    default:
      return null;
  }
}

export function startMockSupabase({ port, latencyMs = 15, maxConcurrent = 0, host = "127.0.0.1" }) {
  const stats = { total: 0, byKey: {}, inFlight: 0, peakInFlight: 0, queued: 0, peakQueued: 0, startedAt: Date.now() };
  const waiters = [];
  const acquire = () =>
    !maxConcurrent || stats.inFlight < maxConcurrent
      ? Promise.resolve()
      : new Promise((resolve) => {
          waiters.push(resolve);
          stats.queued = waiters.length;
          stats.peakQueued = Math.max(stats.peakQueued, waiters.length);
        });
  const release = () => {
    const next = waiters.shift();
    stats.queued = waiters.length;
    if (next) next();
  };

  function respond(req, res, m, url) {
    if (!m) return json(res, 404, { message: "not modelled" });
    const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    if (m[1]) return json(res, 200, null); // RPCs: no result (callers fall back or treat as empty)
    if (req.method === "HEAD") return json(res, 200, undefined, { "content-range": "*/0" });
    if (req.method !== "GET") {
      const rep = String(req.headers.prefer ?? "").includes("return=representation");
      return rep ? json(res, 200, wantsObject ? {} : []) : json(res, 204, undefined);
    }
    const rows = rowsFor(m[2], eqFilters(url.searchParams)) ?? [];
    if (!wantsObject) return json(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    if (rows.length === 1) return json(res, 200, rows[0]);
    return json(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === "/__stats") return json(res, 200, { ...stats, elapsedMs: Date.now() - stats.startedAt });
    if (url.pathname === "/__reset") {
      Object.assign(stats, { total: 0, byKey: {}, peakInFlight: 0, peakQueued: 0, startedAt: Date.now() });
      return json(res, 200, { ok: true });
    }
    req.on("data", () => {});
    req.on("end", async () => {
      const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([\w.]+)$/);
      const key = m ? `${req.method} ${m[1] ? "rpc:" : ""}${m[2]}` : `${req.method} ${url.pathname}`;
      stats.total += 1;
      stats.byKey[key] = (stats.byKey[key] ?? 0) + 1;
      await acquire();
      stats.inFlight += 1;
      stats.peakInFlight = Math.max(stats.peakInFlight, stats.inFlight);
      setTimeout(() => {
        stats.inFlight -= 1;
        release();
        try {
          respond(req, res, m, url);
        } catch (err) {
          json(res, 500, { message: err instanceof Error ? err.message : String(err) });
        }
      }, latencyMs);
    });
  });
  server.keepAliveTimeout = 65_000;

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ server, stats }));
  });
}
