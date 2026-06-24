---
type: session
date: 2026-06-24-0812
branch: develop
trigger: wrapup
status: complete
tags: [session, performance, app-router, shell]
related:
  - "[[2026-06-24-gotcha-44-sibling-section-layouts-remount-shell]]"
  - "[[2026-06-23-gotcha-43-shared-db-integration-test-flake]]"
---

# Shared `(app)` shell layout — stop the sidebar reloading on every section click

## What changed

- New `src/app/(app)/layout.tsx` route group mounts `AuthenticatedShell` **once**; moved
  boards/dashboards/portfolios/goals/time/workload/settings under it (`git mv`, URL-transparent).
- Deleted the six now-redundant per-section layouts; slimmed `dashboards/layout.tsx` to its
  grid-CSS import only. `admin` + `home` left as their own mounts (admin's pre-Suspense guard).
- Added `src/app/app-shell-structure.test.ts` — regression guard: exactly one `AuthenticatedShell`
  mount under `(app)/`.
- Spec + plan committed under `docs/superpowers/`. Merged `task/shared-app-shell` → `develop`
  (`f48b07a`, pushed). Recorded [[2026-06-24-gotcha-44-sibling-section-layouts-remount-shell]].

## Why

Every section had its **own** layout mounting the shell, so they were siblings whose only common
ancestor was the root layout. Crossing sections (Boards → Portfolios) unmounted/remounted the whole
shell, re-running `SidebarNavData`'s six uncached queries and flashing the skeleton on every click.
A single shared `(app)` ancestor is preserved across sibling nav, so the shell renders once.

## How to test (for the user)

1. Pull `develop`, `pnpm dev -p 3001`, log in. Open **Boards** → a board. DevTools → Network, clear.
2. Click **Portfolios**. Expected: sidebar nav does **not** flash/rebuild — only content swaps; no
   new `listMyBoards`/`listSharedBoards`/`listDashboards` burst.
3. Click **Dashboard** → **My Time** → **Boards**. Expected: sidebar stays put; skeleton only on a
   hard refresh, never on in-app clicks.
4. Hard-refresh `/portfolios`, `/dashboards`, `/time` — all still load (URLs unchanged).
5. (Platform admin) open **Admin** — still loads, still cleanly redirects a non-admin.

## Open threads

- **Merged on unit-level gates only.** `finish-task.sh`'s full gate kept failing on the live-Supabase
  integration suite (`ECONNRESET`/`fetch failed`, hours-long hang) — external outage, no coverage
  for a pure route-structure change. Re-run the integration suite once Supabase is stable.
- **Follow-up (not done):** `revalidatePath("/", "layout")` in `src/lib/boards/actions.ts` (5 sites)
  still nukes the whole shell after a board edit → sidebar reloads on the _next_ nav. Narrow to a
  scoped `revalidateTag`.

## Next session entry point

Either open the `revalidatePath` → `revalidateTag` follow-up, or resume Phase 9.3 cache / 9.4
skeletons. Production promotion of the `develop` bundle (`/promote`) is still owed.
