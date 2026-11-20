# Rendly real-time load test — results (2026-11-20)

**Verdict: today's backend handles about 500 concurrent users. It does not handle
1,000–2,000.** Every flow works at 500 users; from 1,000 up, sockets stop connecting
and signaling lags by seconds.

Setup: local stack (auth-service + chat-service from source, mock Supabase with 15 ms
per query), synthetic users, one 4-core i5-10210U laptop with 7.8 GB RAM that also ran the
load generator. Ramp 30 s, hold 60 s per level. Raw data:
`loadtest/results/ladder/*/summary.json`. How to run and the full test plan: `README.md`.

## Results

| Run | Users connected (peak) | Flows that connected | Worst p95 | chat-service loop p99 | auth-service CPU (avg) | DB q/s | Verdict |
|---|---|---|---|---|---|---|---|
| Mixed 100 | 100/100 | 100% | REST 336 ms | 70 ms | 13% | 25 | **Pass** |
| Mixed 500 | 500/500 | 100% | Spark "match ended" 4.1 s (mass logout only) | 122 ms | 38% | 130 | Pass except that one check |
| Mixed 1,000 | 805/1,000 | 82–85% | connect 6.7 s, Spark join 3.3 s | 703 ms | 50% | 197 | Fail |
| Mixed 2,000 | 654/2,000 | 24–36% | connect 4.4 s | 577 ms | 39% | 150 | Fail |
| Whisper only 2,000 | 836/2,000 | — | — | 494 ms | 1% | 9 | Fail |
| Spark only 2,000 | 696/2,000 | — | — | 622 ms | 33% | 164 | Fail |
| Huddle only 2,000 | 652/1,998 | — | — | 651 ms | **74%** | 358 | Fail |
| Mixed + app polls 1,000 | 1,000/1,000 | — | — | 640 ms | **92%** | 349 | Fail |
| Mixed + app polls 2,000 | 892/2,000 | — | — | 578 ms | **95%** | 483 | Fail |
| Mixed, WebSocket-only 1,000 | 1,000/1,000 | 100% | relay 1.9 s, Spark join 7.2 s, connect 6.9 s | **1,433 ms** | 53% | 254 | Fail (all connect, but laggy) |
| Mixed, WebSocket-only 2,000 | 1,106/2,000 | 54–56% | connect 19 s, relay 2.6 s | **1,812 ms** | 68% | 268 | Fail |

"Loop p99" is the server's event-loop delay: how long any request waited before the server
could even look at it. Above ~200 ms the app feels laggy; above 1 s it feels hung.

## Where it breaks

1. **chat-service: the online/offline broadcast to everyone (main cause).** `ws.ts:106` and
   `ws.ts:278` send `user:online` / `user:offline` to every connected socket on each connect
   and disconnect, so work grows with users². Evidence: the Whisper-only run barely touched
   the database and auth-service sat at 1% CPU, yet chat-service still capped at 836 sockets
   with 0.5 s stalls; with WebSocket-only connects all 1,000 users got in but stalls grew to
   1.4 s. Not yet confirmed by re-running with the broadcast removed.
2. **Long-polling handshake adds connection failures.** All 1k–2k connect failures were
   `xhr poll error` / `xhr post error`. WebSocket-only raised connected users from 828 to
   1,000 (at 1k) and from 794 to 1,125 (at 2k).
3. **auth-service runs out of CPU from polling.** Every REST call re-reads the user row (no
   cache), and the app polls a lot: Spark status every 1.5–3 s (~6 queries each), Huddle
   member list every 5 s, points / match-active / heartbeat in the background. With those
   polls, auth-service averages 92% of one core at 1,000 users.
4. **Database load is driven by polling.** One Spark status poll costs about 6 queries
   including the pairing RPC `match_waiting_user`, so each searching user sends roughly 2–4
   queries/s. The mock does not show lock contention inside the Spark RPCs; test against a
   disposable Supabase project before launch.

Not a limit: the relay logic itself (in-memory relays were 2–30 ms at 500 users), memory
(every process stayed under 600 MB), concurrent database queries (peak 52 in flight).

## What to do to reach 2,000 users

Code changes, no new dependencies. Do these first and re-test after each:

1. Send online/offline only to the people who need it (conversation partners), or let clients
   ask with the existing `presence:query`. Remove the global `io.emit` in `ws.ts`.
2. Cache the authenticated user for ~60 s after JWT verification in both services
   (`getCurrentUserFromRequest`).
3. Push instead of poll: the server emits a Spark match event instead of 1.5 s status polling
   (keep a 10 s fallback poll); drive the Huddle member list from `huddle:peer-joined` / left
   events; push points changes (the socket event already exists).
4. Connect with `transports: ["websocket"]` in `frontend/services/websocket.ts`.

Infrastructure (needs approval: Redis, `@socket.io/redis-adapter`, a Redis rate-limit store):

5. Run 2–4 chat-service processes behind sticky sessions with the Redis adapter, and 2+
   auth-service processes. Before that, move in-memory room state (huddle rooms and
   assignments, Spark pairings and holds, call grace timers) to Redis or pin each room to one
   process.
6. Supabase: use the transaction pooler; check indexes on `match_queue(user_id, status,
   matched_at)` and `huddle_participants(huddle_id, user_id)`; size compute from the query
   counts above. Plan TURN bandwidth separately (relayed calls are not covered here).

Re-test with `node loadtest/run.mjs --feature mixed --users 1000,2000 --keep-going --background`.
Target: every level PASS.

## After fixes 1–4 (same day)

Applied: targeted presence (`ws.ts`), 60 s user cache in both services (dropped on user
updates), WebSocket-first client, Huddle participants poll members every 20 s plus on
join/leave (hosts stay at 5 s), Spark slow poll 3 s → 5 s. Re-run: mixed, app polls on,
WebSocket-first (`results/after-fixes/`).

| Users | Connected | chat-service loop p99 | Real-time flows | auth-service | REST |
|---|---|---|---|---|---|
| 1,000 | 1,000/1,000 | 49 ms (was 640) | all pass | CPU avg 95%, loop p99 432 ms | p95 1.7–4.2 s, ~1.5% errors |
| 2,000 | **2,000/2,000** | **102 ms** (was 578) | all pass (end-of-call notice 315–361 ms in the mass-logout burst) | CPU avg 109%, saturated | p95 5–9 s, **~50% errors** |

chat-service now holds 2,000 users. **auth-service is the remaining limit:** one Node
process cannot serve the REST polling of 2,000 users (~600 requests/s). Next steps, in order:
run auth-service on several cores (Node cluster or 2–4 instances behind the load balancer;
move the rate limiter to a shared store and check `githubCodeCache` works across instances),
and replace the remaining background polls (points and `match/active` every 10 s on live
pages) with socket pushes.

## After scaling auth-service (same day)

auth-service now starts through `src/cluster.ts` (`npm start` → `node dist/cluster.js`):
`AUTH_WORKERS` processes (default: CPU cores, max 4) sharing one port, with rate limits and the
GitHub code cache shared through Redis (`src/shared-state.ts`, `REDIS_URL`). Without
`REDIS_URL` it stays one process. Re-run: 2,000 users mixed, app polls on, WebSocket-first,
3 auth workers, local mock Redis (`results/after-scale/`):

- **2,000/2,000 connected, 0 unexpected disconnects; every call, match and huddle connected.**
- REST p95 264–493 ms (was 5–9 s); 119 of 121,263 operations failed (0.1%, `fetch failed`,
  nothing in the service log); acked socket events p95 ≤ 170 ms.
- Server event-loop p99 ≤ 155 ms; CPU avg 53% (auth) / 45% (chat). Only the per-second CPU
  peak check fails (153% / 117% in single samples), on a laptop shared with the generator.

Production needs a real Redis (docker-compose has one) and `REDIS_URL` set for auth-service.
The user cache is per process, so a username change can take up to 60 s to show on other
workers.

## Other findings

- Whisper chat history is one JSON blob per user (`user_chat_data`), rewritten on every
  message; under heavy chat it grows and can race. Not load-tested here.
- `listConversationPartnerIds` falls back to reading every row of `user_chat_data` when its RPC
  is missing (`db.ts:679`). Make sure the RPC exists in production.
- The Huddle room cap in code is 12 (`breakout-rules.ts`); the spec says 6. The test used 6.

## Caveats

Generator and servers shared one laptop, so absolute numbers are a conservative lower bound;
the bottlenecks above would appear on any single Node process. The database is a
fixed-latency mock.

## All features at 2,000 users, with messaging (same day)

Added: Whisper messaging in the test (each user in a call sends a chat message every ~6 s
through `POST /api/conversations/:id/messages`, timed until the partner gets
`message:received`), and auth-service workers now drop a changed user from every worker's cache
through Redis pub/sub (`shared-state.ts`). Runs: 2,000 users per feature, app polls on,
WebSocket-first, 3 auth workers, mock Redis (`results/final-2000/`).

| Run | Connected | Result |
|---|---|---|
| Spark 2,000 | 2,000/2,000 | Every match, call and chat works. Only "match ended" notice p95 586 ms in the mass-logout burst |
| Huddle 2,000 | 1,998/1,998 | Every room, call and chat works. ~1.2% of background REST polls failed (`fetch failed`) |
| Mixed 2,000 | 2,000/2,000 | Everything connects and completes, but relays slow to 0.7–0.9 s p95, Spark join 3.9 s, message send 2.8 s |
| Whisper + messaging 2,000 | 1,906/2,000 | **Fail:** 42% of message sends failed, delivery p95 11 s, calls slow (setup 4.5 s) |

**New limit: chat-service CPU when many people message at once.** In the Whisper run about
330 messages/s pushed chat-service to 98% CPU (loop p99 718 ms), and calls in the same process
slowed with it. This test rate is heavy (every user in a call messaging every 6 s, nonstop);
real traffic is lower, but one chat-service process is still the ceiling. Next steps:
1. Profile the message send path (`server.ts:271`) and cut per-message work (user lookup,
   conversation checks, the `user_chat_data` JSON rewrite, notifications).
2. Run 2+ chat-service processes: needs `@socket.io/redis-adapter` (new dependency, needs
   approval) and sticky sessions, and moving in-memory room state to Redis first.

## Messaging fixes and re-runs (same day)

chat-service message path trimmed: date formatters built once (they were the largest cost
inside the send handler), per-message info logs only with `CHAT_VERBOSE_LOGS=1`, recipient
username cached 60 s (`getUserByIdCached`), verified JWTs reused up to 60 s (never past
`exp`), and a known unread message notification is refreshed in one query instead of two.
At 1,500 users messaging every 6 s, send failures fell from 32% to 19%; chat-service is still
CPU-bound at that rate (~260 messages/s on one process).

2,000-user re-runs (`results/msg-6000/`, `results/msg-30000/`) are **not reliable**: the
generator's own event loop reached 110–190 ms (it was 25 ms in earlier runs) and results
contradict each other (mixed at a 30 s message interval did worse than at 6 s), so the laptop
was busy with other work during the runs. The one clean signal: Whisper with a realistic rate
(a message every 30 s) kept chat-service at loop p99 62 ms with every call and message
delivered; only ~5% of background auth-service polls failed. Re-run on an idle machine before
drawing conclusions; for sustained heavy chat, chat-service needs more than one process
(Redis adapter, needs approval).
