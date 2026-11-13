# Decisions

Format: ID — date — status — decision — rationale — source.

## D-001 — 2026-11-09 — accepted
Project state lives in `.claude/state/` (GOALS, TASKS, DECISIONS, ACTIVE). Tasks ranked by
blocks-other-work > MVP-critical per spec > risk. Each task carries a source reference; inferred items are labelled.
Source: user instruction (bootstrap protocol).

## D-002 — 2026-11-09 — accepted
ECC `/project-init` run as dry-run only. Plan resolved to 592 copy operations, all targeting the
global `~/.claude` home (rules/agents/commands/hooks), not this repo. Not applied: ECC rules are already
installed globally and the user scoped this bootstrap to project files.
Command: `node ~/.claude/plugins/cache/ecc/ecc/2.0.0/scripts/install-apply.js --target claude --dry-run --json typescript`.

## D-003 — 2026-11-09 — OPEN (needs user)
MVP scope conflict: spec §5.1 marks Huddles (FR6), Media (FR7), Admin (FR10) as MUST; Documentation Index
marks them SHOULD; System Design Phase 1 excludes Huddles. Code already ships Huddles.
Working assumption until decided: follow spec §5.1 (most detailed, most recent-looking source).

## D-004 — 2026-11-09 — OPEN (needs user)
FR1/NFR3 say OAuth only with no non-OAuth signup, but auth-service exposes password login,
forgot-password and reset-password (`auth-service/src/server.ts:240,273,329`). Either the spec changed
or the code drifted. Decide: remove password auth, or amend the spec.

## D-005 — 2026-11-09 — OPEN (needs user)
Uncommitted `rendly-mvp/frontend/tsconfig.json` change (strict → false, moduleResolution bundler → node,
include list replaced with globs + trailing-space `.next /` paths) looks auto-written by Next.js dev
server, not intentional. It breaks `next build`. Proposed: restore HEAD version (see T-001).
