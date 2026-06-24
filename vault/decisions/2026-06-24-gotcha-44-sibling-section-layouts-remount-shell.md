---
type: adr
date: 2026-06-24
status: accepted
tags: [decision, gotcha, app-router, performance, shell, nextjs]
related:
  - "[[2026-06-24-0812-shared-app-shell-layout]]"
  - "[[2026-06-24-0907-reorder-board-no-shell-reload]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Gotcha 44: per-section sibling layouts re-mount the shared shell on every cross-section nav

## Context

The authenticated shell (sidebar nav, header, command palette) was mounted by **each section's own**
`layout.tsx` — `boards/`, `dashboards/`, `portfolios/`, `goals/`, `time/`, `workload/`, `settings/`
each rendered `<AuthenticatedShell>`. These are **sibling** route segments: their only common
ancestor is the root `app/layout.tsx`.

The App Router only preserves a layout across navigation **within its own subtree**. So
`/boards/A → /boards/B` was fine (stays inside `boards/layout.tsx`), but **crossing sections**
(`/boards → /portfolios`) unmounted the entire boards shell and mounted a fresh portfolios shell —
re-running `SidebarNavData`'s six uncached per-user queries and re-flashing the `SidebarNavSkeleton`
on **every sidebar click**. Looks like "the whole sidebar reloads each time," because it does.

This is the layout-placement cousin of [[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]
(that one: using `<Link>`/router nav for in-page view switches re-runs page queries; this one: a
shared chrome placed in sibling layouts re-mounts on cross-section nav).

## Decision / what to do

**Mount shared chrome on a single common-ancestor layout, never per-section.** Put the sections
under one route group — `src/app/(app)/layout.tsx` renders `AuthenticatedShell` once; route groups
are URL-transparent so paths don't change. Then the group layout is the preserved ancestor and the
shell renders once per page load.

Rules of thumb:

- If two sibling sections share chrome, that chrome belongs on their **common parent** layout, not
  duplicated in each. Duplicated mounts = guaranteed remount when you navigate between them.
- Exceptions stay **outside** the group when they need behavior the shared layout can't give:
  `admin` runs `requirePlatformAdmin()` **before** any Suspense boundary (a shared layout would run
  the guard inside the shell's Suspense → mid-stream client redirect); `home` is a one-shot
  dispatcher. Both keep their own mount deliberately.
- Guard it with a structural test (`src/app/app-shell-structure.test.ts`): exactly one layout under
  `(app)/` may import `AuthenticatedShell`. Prevents silently re-introducing a per-section mount.

Sequel: the same `revalidatePath("/", "layout")` in `src/lib/boards/actions.ts` reloaded the shell
after a board mutation (sidebar reloads on the _next_ nav). The **reorder** slice was fixed in
[[2026-06-24-0907-reorder-board-no-shell-reload]] (dropped the revalidate — reorder is optimistic +
persisted, so it never needed it). rename/delete/create/duplicate still revalidate; killing those
reloads needs a shared client boards store (optimistic membership/labels), still open.
