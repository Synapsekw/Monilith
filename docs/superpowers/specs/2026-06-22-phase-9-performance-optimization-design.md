# Phase 9 — Performance & Perceived-Performance (umbrella design)

**Status:** approved design (umbrella) — individual sub-projects each get their own spec → plan → build.
**Date:** 2026-06-22
**Motivation:** The landing-page TTFB fix (static `/` hero + `/home` dispatcher, promotion #28) made the public landing feel instant. The authenticated app is still a per-request dynamic render and feels heavier. This phase closes that gap on both the **actual-speed** and **perceived-speed** fronts.

## The core realisation

The landing is instant because it became **static edge HTML**. The authenticated app **cannot** be static — boards, dashboards, goals, portfolios are all per-user, RLS-scoped live data fetched per request. So the goal is not "make it static" but:

> **Make the authenticated app _feel_ as instant as the landing** — by removing wasted server work (actual speed) and by always showing structured, immediate feedback (perceived speed).

Two tracks, one goal.

## Success budget (measurable — the Phase-9 acceptance gate)

On a typical authenticated board page, production, mid-tier device:

| Metric                | Target               | Why                                                                 |
| --------------------- | -------------------- | ------------------------------------------------------------------- |
| TTFB                  | < 200 ms             | Today pays 1–2 auth-server round-trips + dynamic render before HTML |
| LCP                   | < 1.5 s              | Streaming shell paints chrome immediately                           |
| INP (interaction)     | < 200 ms             | Cells/panels/drag feel instant                                      |
| CLS                   | < 0.1                | Skeletons reserve final layout; no jump                             |
| First-load JS / route | meaningful reduction | Heavy libs code-split off the critical path                         |

These are enforced in 9.6 (Lighthouse CI + Web Vitals instrumentation).

## Current-state evidence (why these levers)

- **Double auth round-trip.** `src/proxy.ts` calls `supabase.auth.getUser()` (network → Supabase auth server) on every request; the page/layout then calls it again via `requireUser()`/`getUser()`. `getClaims()` (local JWT verify) is used **0×**; `getUser()` **39×**.
- **Shell blocks on all data.** `src/app/boards/layout.tsx` parallelises its 8 shell queries (good) but `await`s them all before any HTML ships. No PPR / Cache Components / `use cache`.
- **Only one `loading.tsx`** in the whole app (`boards/[boardId]/`); other sections have no streaming fallback.
- **Heavy client libs** shipped into the app: recharts, pdfjs-dist, react-grid-layout, dnd-kit, framer-motion.

## Track A — Actual speed

### 9.1 Auth fast-path (`getClaims`)

Replace the network `auth.getUser()` with `getClaims()` (local, JWKS-cached) in `proxy.ts` and `src/lib/auth/session.ts`. Removes 1–2 auth-server round-trips from **every** authenticated request — the highest impact-per-effort lever.

- **Prerequisite (spec step 1):** confirm the Supabase project uses **asymmetric JWT signing keys** (ECC/RSA). If still on the legacy shared HS256 secret, `getClaims` cannot verify locally without the secret and degrades to a network call — so we migrate to signing keys first (Supabase dashboard → JWT keys), or scope 9.1 to "enable signing keys + swap".
- **Security decision (accepted):** local verify trusts the JWT until expiry (~1h), so a _just-revoked_ session stays valid until its token expires. Accepted for normal routes. **Keep `getUser()` server-revalidation on the most sensitive actions** (admin console, user suspend/delete) so revocation is caught instantly there.
- **Consumes:** existing Supabase SSR clients. **Produces:** a `getClaims`-based session helper + proxy auth check.

### 9.2 Streaming shell (Next 16 PPR / Cache Components)

The sidebar + header chrome prerenders and paints instantly; per-user data streams into `<Suspense>` boundaries. The bridge between actual and perceived speed.

- **Consumes:** section layouts (`boards`, `dashboards`, `goals`, `portfolios`, `settings`). **Produces:** static shell + streamed data regions + the skeletons from 9.4 as fallbacks.
- Coordinated with 9.3 and 9.4 (shares the layout files and skeleton components).

### 9.3 Cache semi-static per-user data

Tagged `use cache` (Next 16 Cache Components) for the sidebar lists — workspaces, boards, dashboards, org, `isPlatformAdmin`/`isOrgAdmin` — invalidated on the relevant mutation (`cacheTag`/`updateTag`). Cross-section navigation becomes near-free.

- **Depends on 9.2** (same Cache Components enablement; overlaps the layout files).

### 9.5 Bundle & render

Code-split heavy libs off the first-load critical path: recharts → dashboard widgets only, pdfjs (confirm already lazy), react-grid-layout (dashboard canvas), dnd-kit (board/kanban). Route-level bundle analysis; trim hot-path re-renders in the board table.

- **Fully independent** of the auth/streaming levers — can run in parallel.

## Track B — Perceived speed

### 9.4 Loading & feedback polish

Make sure the user _never_ sees a dead/blank moment:

- **`loading.tsx` for every section** (today only `boards/[boardId]/`) with **content-shaped skeletons** that mirror the final layout (board grid, dashboard widgets, goals tree, portfolios grid) — not spinners — so there is **zero layout shift** when data arrives. These double as the 9.2 Suspense fallbacks.
- **Pending states on every mutation** — `useTransition`/form pending so buttons show progress; no dead clicks.
- **Optimistic UI audit** — confirm coverage on the hot mutations (cell edits already optimistic per the boards work); fill gaps.
- **Intent-based prefetch** — Next `<Link>` prefetch on hover/viewport for sidebar nav + board rows so navigation feels instant.
- **Verify in-page toggles stay client-side** — views/tabs/filters/sorts must not trigger RSC nav (gotcha-09); audit and fix any regressions.
- **No CLS** — reserve space for async content (avatars, images, streamed regions).

## Closing gate — 9.6 Measure & verify

- Web Vitals instrumentation (real-user) + Lighthouse CI against the budget above.
- Supabase advisors clean (security/perf — partially done in the 2026-06-21 cleanup; finish the by-design definer items if cheap).
- Accessibility audit (keyboard, focus, contrast, reduced-motion).
- The budget is the merge gate for closing Phase 9.

## Execution DAG

```
9.1 (auth fast-path)         ── foundational, independent, do first
        │
        ▼
9.2 (streaming shell) ── 9.3 (cache)   ── together; share layout files + Cache Components
        │
        ├──────────────┐
        ▼              ▼
9.4 (perceived)   9.5 (bundle)         ── parallelisable (9.4 shares skeletons with 9.2)
        │              │
        └──────┬───────┘
               ▼
9.6 (measure & verify)   ── spans the phase, closes it
```

- **Critical path:** 9.1 → 9.2 → 9.4 → 9.6.
- **Parallel batches:** {9.2, 9.3} after 9.1; {9.4, 9.5} after 9.2.
- Each sub-project ships its own worktree + spec → plan → tests, integrated via `finish-task.sh`, measured against the budget.

## Risks & decisions

- **9.1 prereq risk:** if the project is on legacy HS256, enabling asymmetric signing keys is an auth-config change — rotate carefully (existing sessions stay valid; new tokens use the new key). Verified as 9.1 spec step 1.
- **9.2 risk:** PPR / Cache Components is a newer Next 16 surface — confirm APIs against `node_modules/next/dist/docs/` and the `vercel:next-cache-components` guidance; roll out section-by-section, not big-bang.
- **Decision — measurable budget over vibes:** Phase 9 "done" is the budget table, instrumented.
- **Decision — `getClaims` scope:** local verify for normal routes; `getUser` revalidation retained on sensitive admin actions.

## Out of scope (YAGNI)

- 6e collaborative Docs (separately deferred).
- Rewriting the data layer / moving off Supabase.
- Edge-runtime migration (Fluid Compute Node is fine; revisit only if data says so).
