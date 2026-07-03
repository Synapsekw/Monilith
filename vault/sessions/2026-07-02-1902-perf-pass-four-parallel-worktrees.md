---
type: session
date: 2026-07-02-1902
branch: develop
trigger: wrapup
status: complete
tags: [session, performance]
related: []
---

# Perf pass: four parallel worktree tasks merged

## What changed

- 5-agent perf audit of the whole app (data fetching, caching, client interactions, bundle, DB), then 4 tasks built in parallel worktrees via subagent-driven development, each reviewed + fix-looped before merge.
- Batch C (`af34669`): migration `20260702120000_perf_set_based_rls_and_indexes.sql` — 26 SELECT policies rewritten from per-row `can_read_board`/`is_org_member` calls to set-based semijoins (`readable_board_ids()`/`auth_user_orgs()` InitPlans), pg_trgm GIN on `items.name`, 5 composite/partial hot-path indexes. **NOT yet applied to cloud.**
- Batch A (`9598ee6`): removed all 10 blanket `revalidatePath("/", "layout")` from board/workspace/dashboard mutations (tags already cover); `getUserOrgs` React-`cache()`d + select narrowed; `getUserTimeZoneCached` with new `profileTag`; settings-page waterfall parallelized; AI action → targeted `updateTag`.
- Batch B (`59e5d72`): Kanban/Gantt/Calendar renderers lazy-loaded (`next/dynamic`); relation search debounced 200ms (+ `.cancel()` on close); Kanban group-by / Calendar date-column now instant optimistic (no `router.refresh`); board rename refresh dropped (cache patch covers); dashboard widgets batched into one `getWidgetsData` action (was N serialized POSTs). Review caught a Critical (config-sheet preview crashed outside the new provider) — fixed + regression-tested pre-merge.
- Follow-up (`4d98277`): board page derives access in-memory from the payload (`deriveBoardAccess`), dropping 2 redundant round-trips; payload + grants reads parallelized.
- Orchestrator fix `2f90d6c`: `sidebar-nav-data.test.tsx` timeout 5s→20s (RSC render flaked twice under parallel-suite load; passes isolated).

## Why

The app is feature-complete; this session targeted perceived speed. The audit showed excellent architecture undermined by a few systemic leaks — every mutation cold-busted the cached shell, every page re-queried orgs 2-4x, and board reads paid per-row RLS function calls. All four gates (typecheck/lint/test/build) ran green against integrated state on each merge.

## How to test (for the user)

Setup: pull `develop`, `pnpm dev`. First apply the migration (step 0) for the DB wins.

0. Apply `supabase/migrations/20260702120000_perf_set_based_rls_and_indexes.sql` to the cloud dev DB: `supabase db push` (or paste the file into the SQL editor). App works unchanged without it, but RLS/index wins are inert until applied.
1. Rename a board, then navigate Boards → Dashboards → Workload: navigation should feel instant (cached shell survives the mutation; previously every mutation forced ~6 fresh queries on next nav).
2. Open a board → switch to Kanban: view code now loads on demand (brief skeleton first visit, instant after). Change "Group by": regroups instantly, no full-page reload flash.
3. In a relation cell, type quickly in the link-item search: one request after you pause (~200ms), no per-keystroke stutter.
4. Open a dashboard with several widgets: all widgets populate together (one batched request) instead of one-by-one. "Add a widget" opens without crashing (regression-tested).
5. Settings → change timezone → navigate anywhere: new timezone visible immediately.

## Open threads

- **Migration `20260702120000` awaits manual cloud apply (dev), then later prod via /sync-prod.** Agent classifier blocks DDL; after apply I can verify via read-only pg_catalog queries. Types unaffected.
- Deferred minors (triaged, non-blocking): `importSpreadsheetAsBoard` still uses root-layout revalidate (needs a `boardsTag` update first); renameBoard doesn't invalidate recipients' shared-boards tag (pre-existing); edit-mode widget config preview shows placeholder instead of live data (wants a preview-scoped provider).
- Audit tier-3 items not built this session: `unstable_instant` on page segments, landing-page WebGL deferral, `next/image`/dimensions for avatars, bundle analyzer + `optimizePackageImports: ["radix-ui"]`, TimeCard optimistic totals, bounding `items`/`cell_values` payload reads.

## Next session entry point

Apply + verify migration 20260702120000, then either promote develop → main or pick up the tier-3 perf leftovers / deferred minors above.
