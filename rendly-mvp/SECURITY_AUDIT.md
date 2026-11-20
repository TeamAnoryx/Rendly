# Rendly security audit and launch readiness

Prepared for Anoryx Tech Solutions. Date: 20 November 2026. Scope: `rendly-mvp` backend (auth-service, chat-service), database migrations, frontend, repository, dependencies. A PDF copy is in `SECURITY_AUDIT.pdf`.

## Abstract

This report records a source-code security audit of the Rendly platform against the OWASP Top 10 categories (OWASP Foundation, 2021). The audit found 21 weaknesses, 7 of them critical: broken access control in group chat, private tables exposed to the public database roles, and a fallback signing secret. Nineteen are fixed in code and two by a database migration. Sixteen known dependency vulnerabilities remain open by the owner's decision. Under load, matching and Huddles held at 2,000 concurrent users; heavy messaging saturates the single chat process.

**Status on 20 November 2026.** The code fixes are committed (`c7daf11`). The owner reports that the lock-down migration has been run and the required environment variables are set. A live check the same day showed the services still running the previous code, because the commit had not been pushed. The fixes take effect only after `git push` and a redeploy.

## Verdict

Not ready for a marketing launch yet. Ready once the fixes are pushed and deployed, the admin password is changed, and the dependency upgrades are done or the risk is knowingly accepted.

- Before this audit, any signed-in user could read any group's messages, remove members from any group and make themselves a group admin. Those holes are fixed in code.
- The database trusted the Supabase public API roles with private tables, including every private message. The fix is a database migration, which the owner reports has been run.
- 16 known vulnerabilities sit in dependencies, 2 of them critical. They were not upgraded, by the owner's decision.
- At 2,000 concurrent users, Spark and Huddles held up in the earlier load test; heavy messaging saturated the single chat-service process. That limit still stands.

## How the app was audited

The method follows the OWASP Top 10 categories (OWASP Foundation, 2021), with OAuth checked against RFC 6749 (Hardt, 2012), session tokens against RFC 7519 (Jones, Bradley and Sakimura, 2015), password handling against NIST SP 800-63B (Grassi et al., 2017) and database access against Supabase's row level security guidance (Supabase, n.d.).

1. Listed every HTTP route (about 110 in auth-service, 32 in chat-service) and every Socket.IO event, and checked each for a session check and an ownership check.
2. Read the sign-in, sign-up, password reset, OAuth and admin sign-in code.
3. Searched for injection points: raw SQL, `eval`, shell calls, string-built database filters.
4. Parsed all 68 migrations for tables without row level security, policies and grants.
5. Searched the frontend for script injection, token storage and redirect handling; read `next.config.js` headers.
6. Listed tracked files that look like secrets, and ran `npm audit --omit=dev` in backend and frontend.
7. Ran the backend test suites after the fixes.

Limits: I audited the migrations, not the live database (I do not read `.env` files or hold database credentials). No penetration test was run against production. The fixes were not load tested.

## Findings and fixes

Severity: Critical = data exposure or account takeover; High = serious abuse; Medium/Low = hardening.

### Fixed in code (tested, committed, awaiting push and deploy)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Critical | chat-service: `GET /api/conversations/:id/messages` returned any group's history to any signed-in user who knew the group id | Membership check added (`server.ts`) |
| 2 | Critical | chat-service: `POST /api/groups/:id/members/remove` had no permission check; anyone could remove anyone from any group | Only self-leave, the creator, or an admin removing a plain member (`security.ts: canRemoveMember`) |
| 3 | Critical | chat-service: `PATCH /api/groups/:id/members/role` had no permission check; any user could promote themselves | Creator only, admin/member only, never self (`canSetMemberRole`) |
| 4 | Critical | chat-service: delete-for-everyone and unsend in groups had no membership or sender check | Member required; own messages only, or any message for creator/admin |
| 5 | Critical | Both services fell back to a published JWT secret when `JWT_SECRET` was unset, allowing forged sessions | Services refuse to start in production without it (`resolveJwtSecret`) |
| 6 | High | Deleted-for-everyone messages stayed in the `whisper_messages` / `group_messages` tables, which are the main read path, so they came back on reload | Stored copies are now blanked too (`db.ts: tombstoneTableMessages`) |
| 7 | High | auth-service took the client IP from the request body and `X-Client-IP` / `X-Forwarded-For`; attackers could dodge the admin sign-in lockout and poison security logs | Only the proxy-resolved `req.ip` is used |
| 8 | High | Password reset links were built from the request `Origin`/`Referer` when `APP_URL` was unset; a victim could be emailed a real token pointing at an attacker's site | Production uses `APP_URL` only; no link is sent without it |
| 9 | High | chat-service had no rate limits at all | Per-user limits: 120 sends/min, 60 other writes/min (`CHAT_SEND_RATE_MAX`, `CHAT_WRITE_RATE_MAX`) |
| 10 | High | Blocks were not enforced in whispers or calls (the chat block endpoints are stubs) | A block in either direction now stops whispers and calls |
| 11 | Medium | Password reset ran bcrypt against up to 50 users per request (CPU abuse) and missed tokens beyond 50 | Token stored as SHA-256, found with one lookup; password capped at 128 characters |
| 12 | Medium | Rate-limit keys were a hash of any `Authorization` header, so random headers gave unlimited budgets | Key is the verified token's user, else the IP |
| 13 | Medium | Profile links (`avatar_url`, `github_url`, `linkedin_url`) accepted any string, including `javascript:` | Only plain https URLs are stored |
| 14 | Medium | Whisper conversation ids accepted a non-UUID second party; messages had no length limit; delete calls accepted unlimited ids | UUID required; 8,000 characters; 100 ids |
| 15 | Medium | No security headers on either API | `nosniff`, `X-Frame-Options`, `Referrer-Policy`, HSTS set by hand |
| 16 | Low | Sign-in answered faster for unknown accounts; sign-in log printed part of the identifier | Dummy password check; identifier removed from the log |
| 17 | Low | JWT verification did not pin the algorithm; admin tokens were not explicitly rejected as user sessions | `HS256` pinned; tokens with an audience rejected |
| 20 | High | GitHub and LinkedIn sign-in used a fixed `state` value, so an attacker could send a victim a callback link and sign them in to the attacker's account (login CSRF) | Random per-attempt state stored in the tab and checked in the callback (`frontend/lib/oauthState.ts`) |
| 21 | Low | The frontend sent no HSTS header | Added in `next.config.js` |

Tests after the fixes: auth-service 377 passed (was 366), chat-service 43 passed (was 33), frontend 247 passed (was 243), `tsc` clean on all three. These are unit tests of the new rules; the changed routes were not exercised end to end against a database, and the OAuth change was not tried against real GitHub or LinkedIn sign-in. Test both sign-in buttons once after deploying.

One behaviour change to know: password reset links issued before the deploy stop working (they expire in an hour anyway).

### Fixed by a database migration (owner reports it has been run)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 18 | Critical | 15 tables had no row level security: `whisper_messages`, `group_messages`, `user_chat_data`, `group_chat_data`, `groups`, `group_members`, `group_invites`, `connections`, `connection_invites`, `user_blocks`, `user_conversation_meta`, `user_group_read`, `user_settings`, `reports`, `contact_requests`. `whisper_messages`, `group_messages` and both message-thread functions were explicitly granted to `anon`. Anyone with the project's anon key could read every private message through the Supabase REST API | `backend/supabase/migrations/20261124_security_lockdown.sql` |
| 19 | Critical | The `chat-media` storage policy named no role, so every API role could read, write and delete private chat files | Same migration drops it |

The frontend does not ship the anon key, which lowers the chance of abuse, but the key is designed to be public and must not be the only barrier. The migration has not been run against any database, so test it on a copy or staging project first if you have one.

**Before running the migration:** confirm both Render services have `SUPABASE_SERVICE_ROLE_KEY` set. The code falls back to the anon key when it is missing, and the migration would then cut the backend off from its data.

## Still open

Launch blockers:

1. **Push and redeploy.** Commit `c7daf11` is not on the remote yet, so production still runs the old code. I could not verify the migration myself; run the two check queries at the bottom of the migration file to confirm it.
2. **Dependency upgrades (you chose not to do them now).** They remain the largest open risk. Backend: 13 advisories (1 critical `proxy-addr`; high: `axios`, `body-parser`, `engine.io`, `socket.io-parser`, `ws`, `path-to-regexp`, `form-data`, `nodemailer`, `sharp`). Frontend: 3 (critical `next`, high `postcss`, `zod`). Most backend fixes are non-breaking (`npm audit fix`); `next`, `zod`, `nodemailer` and `sharp` need major-version upgrades and testing.
3. **Admin password.** It is a weak, guessable value stored in plain text in the host environment. Change it to a long random one before launch.

Should fix soon:

5. Set `ALLOWED_ORIGINS` on both services (they now warn at startup when it is missing). Sessions use bearer tokens, not cookies, so this is hardening rather than an open hole.
6. Sessions last 7 days and cannot be revoked; sign-out and password reset do not end other sessions.
7. Session tokens live in `localStorage`, so any script injection would expose them. The frontend sends no Content-Security-Policy header.
8. Upload routes parse the file before checking the session, and trust the client's file type.
9. Several chat-service routes have no error handling; a database error leaves the request hanging.
10. chat-service `/api/users/block`, `/unblock` and `/api/conversations/clear` are stubs that answer "ok" and do nothing.
11. `GET /api/dashboard/stats` is public (aggregate counts only).
12. Socket events (`call:start`, WebRTC signalling) have no per-event rate limit and no block check.
13. `frontend/.env.production` is tracked in git. Its two keys are public URL settings (I read the key names only, not the values); keep secrets out of it.

Not audited in depth: the OAuth callback handlers, Huddle and intent routes beyond their session checks, and the upload handlers.

No backdoors, hardcoded credentials, raw SQL injection points, `eval` or shell execution were found.

## 2,000 concurrent users

From the earlier load test (`loadtest/REPORT.md`), local machine, mock database:

| Area | At 2,000 users |
|---|---|
| Spark matching | Held up |
| Huddles | Held up |
| Messaging (whispers, groups) | Heavy messaging saturated the single chat-service process |
| auth-service | Runs in cluster mode with shared rate limits; held up |

What this means for launch: browsing, matching and Huddles are fine for 2,000 people online. If a large share of them chat heavily at the same time, messages slow down. Fixing that needs chat-service to run as several processes with a shared Socket.IO adapter, which is not built.

Caveats: the final 2,000-user runs were unreliable because the test laptop was busy, the test used a mock database rather than Supabase, and the fixes in this report (rate limits, block checks, membership checks) add one or two database reads per chat write and have not been load tested.

## Deploy steps

1. Push `main` so Render and Vercel redeploy auth-service, chat-service and the frontend.
2. Confirm `JWT_SECRET`, `APP_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set on both services (neither starts in production without `JWT_SECRET`).
3. Run the two check queries at the bottom of `20261124_security_lockdown.sql`; both should return no rows.
4. Sign in with email, GitHub and LinkedIn, send a whisper and a group message, and delete one, to confirm the app still works.

## References

Grassi, P.A. et al. (2017) *Digital identity guidelines: authentication and lifecycle management*. NIST Special Publication 800-63B. Gaithersburg, MD: National Institute of Standards and Technology.

Hardt, D. (ed.) (2012) *The OAuth 2.0 authorization framework*. RFC 6749. Internet Engineering Task Force.

Hodges, J., Jackson, C. and Barth, A. (2012) *HTTP Strict Transport Security (HSTS)*. RFC 6797. Internet Engineering Task Force.

Jones, M., Bradley, J. and Sakimura, N. (2015) *JSON Web Token (JWT)*. RFC 7519. Internet Engineering Task Force.

OWASP Foundation (2021) *OWASP Top 10:2021*. Available at: https://owasp.org/Top10/ (Accessed: 20 November 2026).

Supabase (n.d.) *Row level security*. Available at: https://supabase.com/docs/guides/database/postgres/row-level-security (Accessed: 20 November 2026).
