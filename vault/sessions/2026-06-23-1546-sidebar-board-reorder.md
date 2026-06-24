---
type: session
date: 2026-06-23-1546
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Sidebar board drag-reorder

## What changed

- New `reorderBoard` server action (`src/lib/boards/actions.ts`) + `reorderBoardSchema` (`src/lib/validations/board-actions.ts`) — scoped to `created_by = auth.uid()`, writes the existing `boards.position` float. No migration / no type regen.
- `BoardsNav.tsx` rewired with dnd-kit (`DndContext`/`SortableContext`, `restrictToVerticalAxis`) over the owned-boards list: hover grip handle, 6px pointer activation distance so clicks still navigate, optimistic local order reconciled on revalidate via render-time prop sync (no `useEffect`).
- Tests: `BoardsNav.test.tsx` (handle render / collapsed / shared absence + position math), `actions.test.ts` (own-board scoping + no-match fail), `board-actions.test.ts` (schema). All gates green: typecheck, lint (0 new errors), test (1276), build.
- Spec: `docs/superpowers/specs/2026-06-23-sidebar-board-reorder-design.md`. Merged via `finish-task.sh` (`4cfcf6e`), pushed to `origin/develop`.

## Why

User wanted Monday-style drag reordering of their boards in the sidebar. Key realization: a board's `position` is read only by its owner (`listMyBoards`), so reordering it is already personal per-user — no per-user table needed for owned boards, keeping this a genuinely small change.

## How to test (for the user)

1. Pull `develop` and run `pnpm dev`; sign in.
2. In the left sidebar **Boards** section, ensure you have 2+ boards you created.
3. Hover a board row → a grip handle (⋮⋮) fades in on the left.
4. Drag a board by the handle past another and drop → list reorders immediately.
5. Click a board name (not the handle) → still navigates to the board.
6. Reload → new order persists.
7. Confirm scope: **Shared with me** rows have no handle; collapsed rail shows saved order with no drag.

## Open threads

- Reordering the **Shared with me** list is deferred — would need a per-user positions table + migration + RLS + query join. Offered to the user as a follow-up.
- Unrelated commit `55fa30d docs(feedback): spec for in-app bug & feature-request reporting` (user-authored) was pushed to `develop` alongside this work at the user's request.

## Next session entry point

Sidebar reorder is done and on `develop` (unpromoted). Next: run `/promote` to ship the pending `develop` bundle, or pick up Phase 9.3 cache / 9.4 skeletons.
