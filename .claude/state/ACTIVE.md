# Active

Updated 2026-11-09.

## Current
- Status: **awaiting user approval of TASKS.md ranking.** No implementation started.
- Next task once approved: T-001 (restore frontend tsconfig.json) — model tier Sonnet, agents: tdd-guide/code-reviewer.

## Baseline (2026-11-09, working tree incl. uncommitted changes, before any fix)

| Check | Command (cwd) | Result |
|-------|---------------|--------|
| FE typecheck | `npx tsc --noEmit -p .` (frontend) | **FAIL** — 10 errors: match/page.tsx 1, profile/page.tsx 2, settings/page.tsx 3, HuddleCreate.tsx 3, tailwind.config.ts 1 |
| FE typecheck, strict override | `npx tsc --noEmit -p . --strict` | FAIL — 1 error (`tailwind.config.ts(155,7) TS1117`) → 9 errors caused by uncommitted `strict:false` |
| FE build | `npx next build` (frontend) | **FAIL** — `Type error` at `app/dashboard/match/page.tsx:253:37`; tsconfig unchanged by build |
| FE lint | `npx next lint` (frontend) | PASS (exit 0) — 32 warnings: 22 no-img-element, 6 react-hooks/exhaustive-deps, 1 no-anonymous-default-export |
| FE unit tests | `npx jest --ci --watchAll=false` (frontend) | PASS — 5 suites, 25 tests |
| BE tests | `npm test` (backend → auth-service) | PASS — 3 suites, 69 tests; warning: worker failed to exit gracefully (leak) |
| BE build | `npm run build` (backend → auth-service tsc) | PASS |
| BE lint | `npm run lint` (backend → auth-service) | **FAIL** — `'eslint' is not recognized as an internal or external command` |

Failures logged as tasks: T-001, T-002 (build/tsc), T-004 (BE lint), T-011 (tailwind), T-014/T-021 (lint warnings), T-015 (leak).
Logs (session scratchpad, not persisted): fe-tsc/fe-jest/fe-lint/fe-build/be-test/be-lint/be-build.log.

## Working tree notes
- Uncommitted (user's, untouched): frontend `tsconfig.json`, `components/shell/NotificationBell.tsx`,
  `styles/rendly-theme.css`, `app/dashboard/dashboard.css` → T-001, T-003.
- Deleted stray untracked `rendly-mvp/frontend/.next ` (see TASKS Done).
- Still present (gitignored, not in scope): `frontend/.next-3011 `, `frontend/.next-3012 ` → T-002.

## Open decisions needing user
D-003 (MVP tier conflict), D-004 (password auth vs OAuth-only), D-005 (revert tsconfig).
