# Tasks

Seeded 2026-11-09. Ranking: blocks-other-work > MVP-critical (spec §5.1/§5.2) > risk.
Status: `todo` | `in-progress` | `blocked` | `done`. "(inferred)" = not stated verbatim in source.
Spec = RENDLY_COMPLETE_PRODUCT_SPEC.md. Paths are relative to `rendly-mvp/` unless rooted.
**Ranking awaits user approval — do not start implementation until approved.**

## Ranked

### T-001 — Restore frontend tsconfig.json (uncommitted regression breaks build) — todo
- Rank 1 · blocks: `next build`, every frontend verification.
- Source: `git diff frontend/tsconfig.json`; baseline (ACTIVE.md). Decision D-005.
- Evidence: working-tree tsconfig sets `strict:false`, `moduleResolution:node`, adds `.next /` includes.
  `tsc` → 10 errors; with `--strict` override → 1 error. `next build` fails at `app/dashboard/match/page.tsx:253`.
- Done when: `next build` and `tsc --noEmit` pass; tsconfig matches HEAD (or an approved variant).
- Verified-by: —

### T-002 — Trim NEXT_DIST_DIR + ignore trailing-space build dirs (root cause of T-001) — todo
- Rank 2 · blocks: T-001 recurring; stray `.next */` dirs.
- Source: `frontend/next.config.js:5` (`distDir: process.env.NEXT_DIST_DIR || '.next'`). Cause (inferred):
  Windows `set NEXT_DIST_DIR=.next-3011 && next dev` keeps the trailing space → dirs `.next-3011 `, `.next-3012 `, `.next `,
  which Next then writes into tsconfig `include`.
- Done when: `distDir` uses `.trim()` with a unit test; remaining `.next-3011 ` / `.next-3012 ` dirs removed (gitignored, not deleted in bootstrap).
- Verified-by: —

### T-003 — Land or discard in-flight NotificationBell portal + z-index change — todo
- Rank 3 · blocks: clean working tree for every following task.
- Source: uncommitted `frontend/components/shell/NotificationBell.tsx` (createPortal, fixed positioning, closes on resize),
  `frontend/styles/rendly-theme.css` (toast/panel z-index 400/300 → 10000), `frontend/app/dashboard/dashboard.css` (+17 lines).
- Done when: user confirms intent; behaviour covered by a test (outside-click inside portal, Escape, resize close); committed by user or reverted.
- Verified-by: —

### T-004 — Fix backend lint (eslint not installed, no config) — todo
- Rank 4 · blocks: lint gate for backend, CI (T-005).
- Source: baseline `npm run lint` → `'eslint' is not recognized as an internal or external command`. No eslint bin in
  `backend/node_modules/.bin`; no backend eslint config (subagent survey). Spec §5.2 NFR6 (ESLint/Prettier).
- Note: needs dependency install — requires approval (no dep changes in bootstrap).
- Verified-by: —

### T-005 — Add CI (GitHub Actions): build, tsc, lint, test for frontend + backend — todo
- Rank 5 · blocks: quality gating of all later work.
- Source: Spec §5.2 NFR6 "CI/CD GitHub Actions"; rendly_devops_infrastructure.md › `### 6.1 GitHub Actions Workflow` (L727). No `.github/` exists.
- Depends on: T-001, T-004.
- Verified-by: —

### T-006 — FR8: implement block/unblock (currently no-op stubs) + 3-report auto-suspend — todo
- Rank 6 · MVP MUST; blocks FR3 quality score and FR10 report queue.
- Source: Spec `### 5.1` FR8 (L414). Code: `backend/services/chat-service/src/server.ts:911-914`
  (`/api/users/block`, `/api/users/unblock`, `/api/conversations/clear` return canned JSON).
  Reporting exists (`auth-service/src/server.ts:1356`, `reports` table in `supabase/migrations/20250610_user_settings_reports_contact.sql`).
  No block table and no auto-suspend found (grep).
- Verified-by: —

### T-007 — Decide + enforce FR1 "OAuth only" vs existing password auth — todo
- Rank 7 · security/scope risk; blocked on D-004.
- Source: Spec FR1 (L340), NFR3; `auth-service/src/server.ts:240,273` (`/api/auth/login` with bcrypt), `:329` forgot-password (dev stub logs link).
- Verified-by: —

### T-008 — FR9: profanity filter, spam detection, 10 msgs/min/conversation, 18+ gate, terms acceptance — todo
- Rank 8 · MVP MUST.
- Source: Spec FR9 (L423). No profanity/bad-word filter found (grep of backend `*.ts`). `moderation-service` is a stub.
  Only rate limit: `chat-service/src/spark-room.ts:14-15` = 20 msgs / 10 s (≠ spec 10/min). 18+ gate and terms: unverified (inferred).
- Verified-by: —

### T-009 — Fix backend docker-compose / deploy path — todo
- Rank 9 · blocks deploy (Spec `### 6.1` Day 20 deploy).
- Source: subagent survey: `backend/docker-compose.yml:80` builds `./services/ccs-service` (doesn't exist; real one is chat-service),
  port 3004 vs README 4002, chat-service has no Dockerfile. `Makefile install` uses `lerna bootstrap` (removed in Lerna 7) (inferred broken).
- Verified-by: —

### T-010 — FR10: basic admin (suspend, report queue, DAU/MAU, bans, mod logs) — todo
- Rank 10 · MVP MUST per spec, SHOULD per index (D-003). Depends on T-006.
- Source: Spec FR10 (L431); `backend/services/admin-service` health-check stub.
- Verified-by: —

## Backlog (unranked beyond top 10)

### T-011 — Fix tailwind.config.ts duplicate key (TS1117) — todo
- Source: baseline `tsc`: `tailwind.config.ts(155,7): error TS1117`. Only fails when the file is in tsconfig `include`.
### T-012 — Verify FR3 matching criteria (≥50% interest overlap, TZ ≤6h, quality score) in spark.ts — todo
- Source: Spec FR3 (L357); `auth-service/src/spark.ts`, `spark-rules.ts` (inferred coverage unknown).
### T-013 — Verify FR4 audio-only fallback, call duration tracking, NFR2 video→chat degradation — todo
- Source: Spec FR4 (L371), NFR2; `frontend/hooks/useCall.ts`.
### T-014 — Fix HuddleRoom effect cleanup ref bug (react-hooks/exhaustive-deps) — todo
- Source: baseline lint `components/huddles/HuddleRoom.tsx:392` ("ref value 'pcs.current' will likely have changed"). 5 more exhaustive-deps warnings.
### T-015 — Backend jest open-handle leak — todo
- Source: baseline `npm test`: "A worker process has failed to exit gracefully … tests leaking due to improper teardown."
### T-016 — Untrack `frontend/tsconfig.tsbuildinfo` (build artifact committed) — todo
- Source: `git ls-files` lists it; now covered by `*.tsbuildinfo` in root `.gitignore`.
### T-017 — E2E setup: Cypress dep present, no config; `tests/e2e`, `tests/integration` empty — todo
- Source: subagent survey; Spec NFR6 (≥60% critical-path coverage); rendly_frontend_architecture.md › `## 10. Testing Strategy` (L1250).
### T-018 — Backend root scripts (test/lint/build) only cover auth-service; chat-service has no tests — todo
- Source: `backend/package.json` scripts.
### T-019 — Remove or wire frontend stubs: `services/matching.ts`, `services/webrtc.ts`, `services/api.ts`, `app/api/{auth,proxy,webhooks}` (501) — todo
- Source: subagent survey (stub bodies / "Not implemented" responses).
### T-020 — `db:migrate` script points at placeholder (`user-service/migrations/run.ts`); migrations actually via Supabase — todo
- Source: `backend/package.json` `db:migrate`; `rendly-mvp/CLOUD.md`.
### T-021 — Replace `<img>` with `next/image` where useful (22 lint warnings) — todo
- Source: baseline lint (NFR1 page load). Low priority.
### T-022 — FR6 SFU requirement vs current mesh huddles (2–100 participants) — todo
- Source: Spec FR6 (L394) names Janus/Mediasoup SFU; current implementation peer-to-peer (inferred from `HuddleRoom.tsx`). Scalability risk above ~6 participants (inferred).
### T-023 — NFR5 accessibility (WCAG 2.1 A) + mobile audit — todo
- Source: Spec NFR5 (L439+). Unverified (inferred).
### T-024 — Reconcile metrics/roadmap inconsistencies across docs — todo
- Source: Spec `### 12.1` vs Index `## 📊 MVP Metrics to Track` (L240); Spec `### 6.1` vs `## SECTION 14` ordering.

## Done
- T-000 — Bootstrap project state; delete stray untracked `rendly-mvp/frontend/.next ` — done 2026-11-09.
  Verified-by: `git ls-files -- ".next "` → 0 files; contents were Next.js dev output (manifests, webpack chunks, trace);
  deleted via `[System.IO.Directory]::Delete('\\?\…\.next ', $true)` → `Exists` = False; regular `.next` intact.
