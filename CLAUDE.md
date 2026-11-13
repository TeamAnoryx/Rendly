# Rendly — Project Guide for Claude

Intent-based social matching platform ("Know Your Why, Find Your Who"): profiles with intents,
1:1 "Spark" matching with video + chat, group Huddles. Specs live in the repo root; code in `rendly-mvp/`.

## Layout
- `rendly-mvp/frontend/` — Next.js 14 (App Router), TypeScript, Tailwind, Jest. Dev port 3001.
- `rendly-mvp/backend/` — npm workspaces (`services/*`, `shared`). Real logic lives in
  `services/auth-service` (auth, profiles, spark/matching, huddles, connections, reports, notifications)
  and `services/chat-service` (Socket.IO chat + WebRTC signaling, :4002). Other services
  (matching, video, user, moderation, huddle, admin) are health-check stubs.
- `rendly-mvp/backend/supabase/migrations/` — SQL migrations (applied via Supabase; see `rendly-mvp/CLOUD.md`).
- Specs: `RENDLY_COMPLETE_PRODUCT_SPEC.md` (MVP scope = §5.1 FR1–FR10, §5.2 NFR1–NFR6),
  `Rendly_System_Design.md`, `rendly_frontend_architecture.md`, `rendly_devops_infrastructure.md`,
  `RENDLY_MULTI_AGENT_AI_BACKEND_ARCHITECTURE.md` (post-MVP).

## Commands
Frontend (`cd rendly-mvp/frontend`):
- Test: `npx jest --ci --watchAll=false`
- Typecheck: `npx tsc --noEmit -p .`
- Lint: `npx next lint`
- Build: `npx next build`
- Dev: `npm run dev` (multiple servers: set `NEXT_DIST_DIR` per server — see TASKS T-002 about trailing spaces)

Backend (`cd rendly-mvp/backend`) — root scripts only target auth-service:
- Test: `npm test`
- Build: `npm run build`
- Lint: `npm run lint` (currently broken — eslint not installed, see TASKS)

## Working state
- Backlog, goals, decisions, and the current task live in `.claude/state/`
  (`GOALS.md`, `TASKS.md`, `DECISIONS.md`, `ACTIVE.md`). Read `ACTIVE.md` first.
- Every task records a source reference and a `Verified-by` line with real command output.

## Rules
- Do not commit or push unless explicitly asked.
- Do not upgrade dependencies without approval.
- Never read or print values from `.env*` files (only `.env.example` is safe).
- Windows host: directory names with trailing spaces need the `\\?\` long-path form to delete.
