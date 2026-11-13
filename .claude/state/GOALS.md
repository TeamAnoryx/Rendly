# Goals

Seeded 2026-11-09 from root spec docs. "(inferred)" = not stated verbatim in a source.

## Product
Rendly — "intent-based social matching platform that connects people in real-time based on shared
interests, goals, and activities." Audience 18–35. Tagline "Know Your Why, Find Your Who".
Source: RENDLY_COMPLETE_PRODUCT_SPEC.md › `## EXECUTIVE SUMMARY` (L3).

## G1 — Ship the MVP feature set (MUST HAVE)
Source: RENDLY_COMPLETE_PRODUCT_SPEC.md › `### 5.1 Functional Requirements (MUST HAVE)` (L337).

| ID | Requirement | Spec line | Code status (2026-11-09) |
|----|-------------|-----------|--------------------------|
| FR1 | OAuth (LinkedIn + GitHub) only, no non-OAuth signup; JWT 15 min / refresh 30 d | L340 | OAuth implemented in auth-service; **password login also exists** (`auth-service/src/server.ts:273`) — conflicts with spec |
| FR2 | Profiles: name, bio, avatar, 3–7 tags, 1 of 5 intents; completion required before matching | L348 | Implemented (frontend `app/profile-setup`, migrations) |
| FR3 | Intent-based matching: same intent, ≥50% interest overlap, TZ ≤6h preferred, quality score hides inactive/reported | L357 | "Spark" in `auth-service/src/spark.ts`; criteria coverage unverified (inferred) |
| FR4 | 1:1 video: accept/decline, audio-only fallback, duration tracking, 360p–720p | L371 | WebRTC via chat-service signaling + `frontend/hooks/useCall.ts`; fallback/duration unverified (inferred) |
| FR5 | 1:1 chat via CCS: text, typing, last 100 msgs, unseen badge, delete own | L382 | Implemented in chat-service |
| FR6 | Huddles 2–100 (SFU) + shared chat thread | L394 | Implemented (mesh WebRTC, not SFU — inferred from `HuddleRoom.tsx` peer map) |
| FR7 | Media via external URLs only (previews) | L407 | Unverified |
| FR8 | 1-click block/unblock; anonymous report; 3 reports → auto-suspend | L414 | Report done (`POST /api/reports`); **block/unblock are no-op stubs** (`chat-service/src/server.ts:913-914`); no auto-suspend |
| FR9 | Profanity filter, spam detection, 10 msgs/min/conversation, 18+ gate, terms acceptance | L423 | No profanity filter found; Spark room limit is 20 msgs/10 s (`spark-room.ts:14-15`), not spec's 10/min |
| FR10 | Basic admin: user mgmt/suspend, report queue, DAU/MAU, bans, health, mod logs | L431 | `admin-service` is a stub |

Tier conflict: RENDLY_DOCUMENTATION_INDEX.md › `### **SHOULD HAVE (if time permits):**` (L207) lists FR6 Huddles,
FR7 Media and FR10 Admin as SHOULD, while spec §5.1 lists them as MUST. Rendly_System_Design.md ›
`### Phase 1 (Months 1-3): MVP` (L2269) excludes Huddles entirely. See DECISIONS D-003.

## G2 — Meet MVP non-functional requirements
Source: RENDLY_COMPLETE_PRODUCT_SPEC.md › `### 5.2 Non-Functional Requirements (SHOULD HAVE)` (L439).
- NFR1 Performance: API p99 <200 ms, chat <500 ms, page load <3 s.
- NFR2 Reliability: 99.5% uptime, graceful degradation (video → chat), health checks every 30 s.
- NFR3 Security: HTTPS, OAuth only, JWT, CORS locked to rendly.io, 100 req/min/IP, parameterized queries, SameSite cookies.
- NFR5 Usability: mobile-first, WCAG 2.1 A, dark mode, onboarding <5 min to first call.
- NFR6 Maintainability: ESLint/Prettier, ≥60% coverage on critical paths, Sentry, **CI/CD on GitHub Actions**.

## G3 — Healthy engineering baseline (inferred)
Green `build`, `tsc`, `lint`, `test` on both apps; CI gating every PR; deployable compose/infra.
Source: NFR6 (above) + rendly_devops_infrastructure.md › `### 6.1 GitHub Actions Workflow` (L727).

## Launch targets (for later prioritisation)
Source: RENDLY_COMPLETE_PRODUCT_SPEC.md › `### 12.1 Launch Day Metrics` (L2825+): Day 1 100–500 signups,
first match 30%+, call success 50%; Month 1 10K signups, D7 retention 25%+, safety <1 report/1000 users.

## Out of scope for MVP
Screen share, recording, AI recommendations, native apps, payments
(RENDLY_DOCUMENTATION_INDEX.md › `### **NICE TO HAVE (Post-MVP):**` L214). Multi-agent AI backend
(RENDLY_MULTI_AGENT_AI_BACKEND_ARCHITECTURE.md — no MVP section; maps to System Design Phase 3–4, inferred).
