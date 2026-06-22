---
type: session
date: 2026-06-22-1441
branch: develop
trigger: wrapup
status: complete
tags: [session, performance, landing, rsc, proxy]
related:
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
  - "[[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]]"
---

# Landing TTFB: static `/` hero + `/home` dispatcher

## What changed

- Diagnosed slow first byte on the deployed landing via the `next build` route table: `/` was `ƒ Dynamic` (per-request serverless fn, cold-start TTFB) because `page.tsx` awaited `getUser()` (→ `cookies()`) on its first line — opting the whole route out of static rendering. `/login`/`/signup`/`/updates` were already `○ Static`.
- Split the two conflated jobs: `src/app/page.tsx` reduced to a pure static Server Component rendering only `<MonolithHero/>` (now `○ Static`, CDN edge); new `src/app/home/page.tsx` holds the authed entry routing verbatim (onboarding → owned board → shared board → welcome), anon → `redirect("/login")`.
- `src/proxy.ts`: redirects an authenticated hit on `/` → `/home` (before the anon-guard); trimmed `config.matcher` to drop `/login`/`/signup`/`/updates` so they serve from the CDN with zero proxy invocation (`/` and `/auth/*` stay matched).
- Tests added/moved: `home/page.test.tsx` (all dispatch branches), rewritten `page.test.tsx` (static hero), new `proxy.test.ts` (redirect logic + matcher regex). Built TDD in worktree `task/landing-ttfb`, merged `6cc46a9` via `finish-task.sh`, pushed (`develop == origin/develop`).
- Verified: build route table now shows `○ /` and `ƒ /home`; typecheck · lint · test (1141) · build all green.

## Why

The public marketing hero is identical for every logged-out visitor with zero per-user data, yet it ran as a dynamic origin function (cold-start prone on a low-traffic invite-only app) instead of cached static HTML — the user's observed "slow first byte" on prod. A Phase-9-hardening fix pulled forward.

## How to test (for the user)

> Setup: `cd /Users/danijeljovanovic/Dev/Monolith && git pull` (on `develop`).

1. `pnpm build` → route table shows `○ /` and `ƒ /home` (`○` = static = the fix).
2. `pnpm start`, open `http://localhost:3000/` logged-out (private window) → MONOLITH hero paints immediately; `/` document is static HTML (Network tab: no server think-time).
3. Logged in, go to `/` → bounced to `/home` → lands on your first board (unchanged behavior).
4. Edge cases: no orgs → `/onboarding`; only a shared board → that board; no boards → "Welcome to {org}" shell.
5. `/updates`, `/login`, `/signup` all still load.
6. Real prod TTFB only changes on Vercel **after `/promote`** (`develop` doesn't deploy to prod).

## Open threads

- Not yet promoted to `main` — the TTFB win is live for users only after a `develop → main` promotion.
- Deferred `getClaims()` app-wide swap (#2): replace `auth.getUser()` (network round-trip per protected navigation) with local JWT verification — separate reviewed task; overlaps `proxy.ts`.
- `/landing` still renders the hero dynamically for both auth states; could be made static-for-anon too (minor).

## Next session entry point

Either run `/promote` to ship this TTFB win to production, or scope the deferred `getClaims()` app-wide auth-validation change (its own task — it changes auth on every protected route). Roadmap proper: 7c Workload/capacity (unspec'd).
