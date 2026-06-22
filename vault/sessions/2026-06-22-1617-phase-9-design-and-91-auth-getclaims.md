---
type: session
date: 2026-06-22-1617
branch: develop
trigger: wrapup
status: complete
tags: [session, performance, phase-9, auth, getclaims]
related:
  - "[[2026-06-22-1441-landing-ttfb-static-hero]]"
  - "[[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]"
---

# Phase 9 design + 9.1 auth fast-path (getClaims)

## What changed

- Brainstormed the **Phase 9 — Performance & Perceived-Performance** umbrella design (`docs/superpowers/specs/2026-06-22-phase-9-performance-optimization-design.md`, `bf84af3`): two tracks (actual speed: 9.1 auth fast-path, 9.2 streaming/PPR, 9.3 cache, 9.5 bundle; perceived speed: 9.4 skeletons/loading.tsx/pending-states/prefetch/zero-CLS) + 9.6 measure-gate with a Web-Vitals budget (TTFB<200ms · LCP<1.5s · INP<200ms · CLS<0.1). North-star Phase 9 → in progress.
- Built + merged **9.1 auth fast-path** (`task/auth-getclaims` → `63ade77`): `src/lib/auth/session.ts` `getUser()` now verifies the JWT **locally** via `getClaims()` instead of the network `auth.getUser()`, returning a narrowed `SessionUser` (`Pick<User, id|email|user_metadata|app_metadata>`). Added `session.test.ts` (7 cases). Every authed page render drops from **2 auth-server round-trips → 1**.
- **Verified prereq:** the project's JWKS endpoint returns an ES256 key → asymmetric signing keys are on → `getClaims()` is a pure-local verify (no per-request network).
- **Key correctness finding:** `proxy.ts` deliberately KEEPS `getUser()` — in the `@supabase/ssr` pattern that call is what _refreshes_ an expiring token; `getClaims()` only verifies and would log users out at expiry. So refresh stays in the proxy; the RSC render reads the already-fresh cookie locally.

## Why

The landing-TTFB win (#28) made the public page instant; the authed app still felt heavy. Phase 9 turns "make it fast" into a sequenced program covering both real speed and perceived speed. 9.1 is the highest impact-per-effort lever — it touches every authenticated request — and de-risks the rest.

## How to test (for the user)

Internal perf change — mostly a no-regression check. Setup: pull `develop`.

1. **Log in** — works as before.
2. **Navigate** boards → dashboards → goals — all load; a touch snappier (one fewer auth round-trip/page). The dramatic perceived win is 9.2.
3. **Forced password change** — a user flagged `must_change_password` still redirects to `/change-password`.
4. **Sign out** → protected routes still bounce to `/login`.
5. Real TTFB delta is visible on prod only after a promote (`develop` ≠ production).

## Open threads

- **9.1 not yet promoted** to `main` — perf win reaches users after `/promote`.
- **Merged via the gotcha-37 hand-merge fallback.** `finish-task`'s full integration suite went red twice on _unrelated_ files (automations-5b1, notifications.rls, time-entries.rls — teardown-purge NPEs under 5+ concurrent worktrees), never on anything in my diff. Deterministic gates all green (typecheck · lint · unit 999/999 · build); hand-merged per the documented fallback.
- **Phase 9 follow-ups noted in the design:** proxy refresh-only-when-near-expiry; `getUser` revalidation on the most sensitive admin actions (defense-in-depth — current admin authz is RPC/RLS-backed so unaffected).
- **Next levers:** 9.2 streaming shell (PPR) + 9.3 cache → 9.4 perceived polish ‖ 9.5 bundle.

## Next session entry point

Start **9.2 — streaming shell (Next 16 PPR/Cache Components)**: prerender the sidebar/header chrome, stream per-user data into Suspense boundaries (the big perceived-speed win, pairs with 9.4 skeletons). Spec it from the Phase 9 umbrella doc. Optionally `/promote` 9.1 first.
