# Sidebar board reorder (drag-and-drop)

**Date:** 2026-06-23
**Status:** Approved

## Goal

Let a user rearrange the order of **their own boards** in the sidebar nav via
drag-and-drop, matching the existing kanban / board-table drag style. Order is
**personal per-user** and persists.

## Key insight: no new table needed

The sidebar renders two lists:

1. **Boards** — boards the user owns (`listMyBoards`, `created_by = me`), ordered
   by the existing `boards.position` (double precision, midpoint strategy).
2. **Shared with me** — others' boards (`listSharedBoards`), ordered by `created_at`.

`boards.position` is read **only by the owner** (no one else lists your boards in
their "My Boards"), so writing it is already personal per-user. Reordering the
**Boards** list reuses the existing column — **no migration, no `db:types` regen.**

## Scope

- **In:** drag-to-reorder the **Boards** (owned) list in expanded sidebar.
- **Out:** reordering **Shared with me** (would need a per-user positions table +
  migration + RLS + query join); dragging in the **collapsed** rail.

## Design

### Data

No schema change. `listMyBoards()` already `ORDER BY position ASC`.

### Server Action — `reorderBoard`

`src/lib/boards/actions.ts`, near-copy of existing `reorderGroup` (actions.ts:229):

- Input validated by `reorderBoardSchema` (Zod) in `src/lib/validations/`:
  `{ boardId: uuid, position: number (finite) }`.
- `update boards set position = $position where id = $boardId and created_by = auth.uid()`
  — own-board scope (belt-and-suspenders over RLS "update if member").
- On success `revalidatePath("/", "layout")` (or the sidebar's path) so
  `SidebarNavData` re-reads order. Return a discriminated `{ ok } | { error }`
  result consistent with the other board actions.

### Client — `BoardsNav.tsx` (already `"use client"`)

Expanded mode only:

- Wrap the owned-boards list in `DndContext` + `SortableContext`
  (`verticalListSortingStrategy`, `restrictToVerticalAxis` modifier) — same
  primitives as `BoardTable` group reordering (BoardTable.tsx:629).
- Each row uses `useSortable({ id: board.id })`.
- `PointerSensor` with a small **distance activation constraint** (e.g. 5px) so a
  normal click still follows the `<Link>` to the board and only a deliberate drag
  reorders.
- `handleDragEnd` → compute new float via existing `reorderPosition()` helper
  (`src/lib/boards/group-reorder.ts:7`) → optimistic local reorder of a
  `useState` list seeded from props (and re-synced when props change) → call
  `reorderBoard({ boardId, position })`.
- **Shared with me** list and **collapsed** rail render unchanged.

### Performance budget (working agreement rule 5)

- First paint: unchanged — boards already load once in `SidebarNavData`.
- Per drag: optimistic client state (0 immediate round-trips for the visual move)
  - **one** Server Action updating a **single row** + targeted revalidate.
- The interaction changes **server data** (board position) → Server Action is
  correct here, not History API.
- Read is the user's own (small) board set.

## Testing (Vitest)

- `reorderBoard` action:
  - valid input updates the row's position;
  - rejects invalid input (bad uuid / non-finite position) via schema;
  - scopes to own boards (does not update a board owned by someone else).
- Drag → position computation: `handleDragEnd` calls `reorderBoard` with the
  float returned by `reorderPosition` for a representative reorder, and is a
  no-op when dropped in place.

## Execution DAG

Small, mostly sequential — one developer/agent:

- **T1** Validation schema (`reorderBoardSchema`) — no deps.
- **T2** Server action `reorderBoard` + tests — depends on T1.
- **T3** `BoardsNav` DnD wiring + tests — depends on T2 (calls the action).

Critical path: T1 → T2 → T3. No parallel batch (each consumes the prior). Build
sequentially.
