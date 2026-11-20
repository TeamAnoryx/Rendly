# Rendly real-time load test

Measures whether the real-time backend (Spark, Whisper calls, Huddles) holds up at
500–2,000 concurrent users. **Local only**: it starts its own copy of `auth-service` and
`chat-service` against a mock database on `127.0.0.1`, with synthetic test users. It never
talks to hosted Supabase or production, and needs no new dependencies (it reuses
`socket.io-client` from `frontend/node_modules` and `jsonwebtoken`/`ts-node` from
`backend/node_modules`).

```powershell
cd rendly-mvp
node loadtest/run.mjs --feature mixed --users 100,500,1000,2000 --ramp 30 --hold 60 --keep-going
```

Options: `--feature whisper|spark|huddle|mixed`, `--users` (comma list = ramp ladder),
`--ramp`/`--hold` seconds, `--workers` (load-generator processes, default 4),
`--db-latency` ms added per database query (default 15, a same-region Supabase round trip),
`--db-max` cap on concurrent database queries (0 = none; models a pooler limit),
`--background` adds the app-wide polls every signed-in tab makes, `--keep-going` runs every
level even after one fails. Results land in `loadtest/results/<run>/<feature>-<users>/`
(`summary.json`, service logs, per-second server probes). `results/` is git-ignored.

## How it works

| Piece | File | What it does |
|---|---|---|
| Runner | `run.mjs` | Per level: fresh stack, fork workers, merge metrics, check thresholds |
| Stack | `lib/stack.mjs` | Starts mock DB + both services (ts-node, transpile-only); forces every DB/env setting local |
| Mock DB | `lib/mock-supabase.mjs` | PostgREST stand-in: rows for test users, fixed latency per query, counts every query |
| Probe | `lib/probe.cjs` | Preloaded into each service: CPU %, RSS, event-loop delay once a second |
| Virtual users | `lib/worker.mjs` | Socket.IO + HTTP clients running the flows below |

WebRTC media is peer-to-peer (TURN aside), so the test covers what the servers carry:
Socket.IO signaling, chat and REST.

## Test plan

### Flows per feature

| Feature | Unit | Flow simulated |
|---|---|---|
| **Spark** | pair | connect → poll `GET /api/match/status` 3× at 1.5 s (search) → `spark:join` (ack, DB) → offer/answer + 8 ICE each way via `spark:signal` (acked) → hold: typing + `spark:chat` every ~6 s per side → `spark:leave` → partner gets `spark:ended` |
| **Whisper call** | pair | connect → `call:start` → callee `call:incoming` → 300 ms later `call:accept` → `webrtc:offer`/`webrtc:answer` + 8 ICE each way → hold (call up, signaling idle) → `call:end` → `call:ended` |
| **Huddle** | 6 people | connect all → `huddle:join` (ack, DB seat check) → full-mesh offer/answer for all 15 pairs + 3 ICE per direction → hold: `huddle:chat` every ~8 s each, `GET /api/huddles/:id/members` every ~5 s each (as `HuddleRoom` polls), host `huddle:rooms` every ~4 s (as `RoomsPanel`) → `huddle:leave` |
| **Mixed** | — | ⅓ of users in each feature at once (the realistic case) |
| **Background** (`--background`) | every user | `GET /api/points/me` 10 s, `GET /api/match/active` 10 s, `POST /api/presence/heartbeat` 30 s |

Each socket connects the way the web app does (`socket.io-client` defaults: long-polling
first, then upgrade to WebSocket; reconnection on), one engine per virtual user.

### Concurrency ramp

100 → 500 → 1,000 → 2,000 concurrent users; each level ramps up over `--ramp` seconds and
then holds everyone connected and active for `--hold` seconds on a fresh stack.

### Pass / fail thresholds (per level)

| Metric | Limit |
|---|---|
| Sockets connected | ≥ 99.5 %, connect p95 ≤ 2 s |
| Flow reaches "connected" (call answered, match signaled, huddle mesh complete) | ≥ 99 % |
| Peer relay p95 (signal, ICE, chat, ring, end) | ≤ 300 ms |
| Acked socket events p95 (`spark:join`, `huddle:join`, …) | ≤ 1,000 ms |
| REST p95 | ≤ 1,000 ms |
| Errors per operation | ≤ 1 % |
| Unexpected socket disconnects | ≤ 0.5 % of sockets |
| Server event-loop delay p99 (any 1 s sample) | ≤ 200 ms |
| Server CPU per process | ≤ 90 % of one core |
| Server RSS per process | ≤ 1.5 GB |

## Limits of this test

- Load generator and servers share one machine, so numbers are a conservative lower bound
  for a dedicated server of similar per-core speed.
- The database is a mock with fixed latency. It shows how many queries each flow sends and
  how the Node tier behaves while waiting on them; it does not show how Postgres itself
  behaves (locks in `spark_enqueue`/pairing RPCs, pooler limits). Use the query counts in
  `summary.json` to size Supabase, or point a later run at a disposable Supabase project.
