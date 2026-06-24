---
type: session
date: 2026-06-24-0907
branch: develop
trigger: wrapup
status: complete
tags: [session, performance, boards, revalidate]
related:
  - "[[2026-06-24-0812-shared-app-shell-layout]]"
  - "[[2026-06-24-gotcha-44-sibling-section-layouts-remount-shell]]"
---

# Reorder a board without reloading the whole sidebar

## What changed

- `src/lib/boards/actions.ts` — removed `revalidatePath("/", "layout")` from
  `reorderBoard` (the other five board mutations keep it). Commit `91e34ea`.
- `src/components/boards/BoardsNav.tsx` — corrected the `ordered`/`syncedBoards`
  comment: reorder is no longer revalidated; the optimistic order is authoritative.
- `src/lib/boards/actions.test.ts` — added a regression test (mocked `next/cache`):
  a successful `reorderBoard` must NOT call `revalidatePath`.
- Done directly on `develop` (trivial-exemption: one-line behavior change), merged
  with unit-level gates — typecheck/lint/build + `actions.test.ts` (19/19). Pushed.

## Why

Follow-up to [[2026-06-24-gotcha-44-sibling-section-layouts-remount-shell]]. After
the shared `(app)` shell landed, dragging a board to reorder it still called the
layout-wide revalidate, busting the shell cache so the sidebar reloaded on the next
navigation. The sidebar already shows the new order optimistically and the position
is persisted, so the revalidate only re-confirmed what was on screen — net cost only.

## How to test (for the user)

1. Pull `develop`, `pnpm dev -p 3001`, log in. Open DevTools - Network.
2. Drag a board by its grip handle to a new position. Expected: order updates
   instantly, no sidebar skeleton flash.
3. Click another board/section. Expected: sidebar does NOT reload (before this, the
   prior reorder forced a full shell re-render here).
4. Hard-refresh — the new order persists.

## Open threads

- **Full scope still open:** make rename/delete/create/duplicate optimistic too (a
  shared client boards store) to kill _all_ board-edit reloads. This session took
  only the zero-risk reorder slice.
- **Unrelated red test on develop:** `src/lib/ai/_debug_generation.test.ts`
  (ai-dashboard-gen) makes a live Anthropic call and fails — tool schema has 26
  optional params (limit 24), and a `_debug_` live-API test shouldn't be in the unit
  project. Owner: AI workstream.

## Next session entry point

`/promote` the `develop` bundle, or pick up the full optimistic-sidebar follow-up.
