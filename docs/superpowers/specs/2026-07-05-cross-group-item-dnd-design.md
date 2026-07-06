---
type: spec
status: draft
date: 2026-07-05
topic: cross-group-item-dnd
tags: [spec, boards, dnd]
---

# Cross-group item drag-and-drop (Table view)

## Problem

In the boards Table view a user can drag a row to reorder it **within** its group, but
cannot drag a row from one group into another. The only way to move an item between
groups today is the bulk "Move to group" menu. Users expect to drag a row across the
group boundary and drop it where they release it.

## Root cause

Each `GroupSection` renders its **own** isolated `<DndContext id="group-items-{groupId}">`
(`BoardTable.tsx` ~L1678) wrapping a `SortableContext` of only that group's item IDs, plus
its own virtualizer. Group reordering is a **separate** `<DndContext>` at the board level
(~L729). Because the item drag contexts are per-group and isolated, a pointer drag can never
cross a group boundary — dnd-kit only tracks draggables/droppables within a single context.

## What already exists (reuse, do not rebuild)

- **Server action** `moveItem({ itemId, groupId })` (`lib/boards/actions.ts` ~L533): moves a
  top-level item to another group on the same board, **appending** to the target group's end,
  and drags subitems' denormalized `group_id` along. Guards: rejects subitems
  (`parent_id !== null`) and cross-board moves. RLS-scoped.
- **Schema** `moveItemSchema = z.object({ itemId, groupId })` (`validations/board-actions.ts`).
- **Optimistic cache helper** `moveItemToGroup(cache, itemId, groupId)` (`lib/boards/cache.ts`
  ~L107): reassigns `group_id`, **appends** (maxPos+1), drags subitems along. Immutable.
- **Bulk path** `bulk-actions.ts` `moveItemsToGroup` + `use-bulk-mutations.ts` (the "Move to
  group" bulk menu) — already wires the optimistic helper + server action per item.
- **Helpers** `midpoint(before, after)` (`lib/boards/position.ts`), `reorderPosition(...)`
  (`lib/boards/group-reorder.ts`, used for group + within-group reorder).

The backend + optimistic layers are complete for **append**. This feature adds **exact-spot
placement** and the **drag-and-drop UX**.

## Decisions (locked)

1. **Drop position:** exact drop spot — insert between the specific rows where released,
   like within-group reorder but across groups.
2. **Collapsed target group:** valid drop target — dropping on a collapsed group appends the
   item to its end (no visible rows to insert between); it appears on expand.
3. **Scope:** top-level items only. Subitems keep their existing within-parent DnD and are
   never moved between groups (server already rejects it).
4. **Architecture:** Approach A — unify group + item drag into a single board-level
   `DndContext`.

## Architecture

### Unified board-level DndContext

Replace the board-level group-reorder `DndContext` **and** the per-group top-level-item
`DndContext` (one per `GroupSection`) with **one** board-level `<DndContext>` in
`BoardTableInner`. The subitem-block `DndContext` inside each expanded parent stays as-is
(see Scope).

- Every draggable carries `data: { type: 'group' | 'item', groupId }` (subitem rows keep
  their own separate `DndContext` inside `SubitemBlock` — unchanged, so subitem drags never
  enter the board-level context).
- Each group is both a `SortableContext` (its ordered top-level item IDs) **and** a droppable
  _container_ registered with `id: group.id`, `data: { type: 'group-container', groupId }`.
- Mounted (virtualized) item rows remain sortable droppables as today.

### Collision detection

Custom strategy: run `closestCenter` over the mounted **row** droppables; if none is under the
pointer (collapsed group, empty group, gap below the last row), fall back to the enclosing
**group container**. This is what makes collapsed-group drops and virtualization correct —
only mounted rows need row-level droppables; the container catches everything else and means
"append to end of this group".

### onDragEnd routing

```
onDragEnd(active, over):
  if active.data.type === 'group':      reorderGroup   (existing reorderPosition logic)
  else // item
    targetGroupId = over.data.groupId (row) or over.id (container)
    if targetGroupId === active.data.groupId:
        reorderItem(active.id, positionWithinSameGroup)   // existing path
    else:
        position = insertPosition(targetGroupTopLevelItems, over) // undefined if container/append
        controls.moveItemToGroup(active.id, targetGroupId, position)
```

`insertPosition(targetItems, over)`: when `over` is a row, find its index in the target group's
position-ordered top-level items and return `midpoint` between it and its neighbor on the drop
side; when `over` is the container (no row), return `undefined` → append.

### DragOverlay

Render a lightweight translate-only row preview in a `DragOverlay` so the dragged row reads
clearly while crossing group boundaries (mirrors the existing group-drag `CSS.Translate`-only
transform; avoids the scaleX/scaleY stretch noted at the group `<section>`).

## Data flow (0 refetch)

1. **Schema:** extend `moveItemSchema` → `{ itemId, groupId, position: z.number().optional() }`.
2. **Server:** `moveItem` uses `position` when provided (place exactly), else appends after the
   target group's last top-level item (current behavior). Subitem + cross-board guards unchanged.
3. **Cache:** extend `moveItemToGroup(cache, itemId, groupId, position?)` — use `position` when
   given, else `maxPos + 1` (append). Still drags subitems' `group_id`.
4. **Mutation:** new single-item `moveItemToGroupMutation` in `use-board-mutations` mirroring
   `reorderItemMutation`: `onMutate` applies the optimistic cache patch, `mutationFn` calls the
   `moveItem` server action, `onError` rolls back to the snapshot. Exposed on `controls` as
   `moveItemToGroup(itemId, groupId, position?)`.
5. **Reconcile:** the Realtime UPDATE echo settles the exact server position afterwards, as it
   already does for `reorderItem` and the bulk move.

Interaction changes **server data** (group membership + position) → Server Action is justified;
optimistic, 0 new server round-trips on the read path; reads stay virtualized/bounded per group.

## Edge cases

- **Drop on origin group** → same-group branch → `reorderItem` (or no-op if position unchanged).
- **Empty / collapsed target group** → container droppable → append.
- **Subitem drag** → separate `SubitemBlock` context, never cross-group (server-guarded too).
- **Active column sort/filter** → consistent with today: a manual drag persists a `position`
  the active sort visually overrides. Not changing that behavior here (out of scope).
- **Move failure** → optimistic rollback via `onError` (silent; no toast primitive exists — same
  as the current reorder path).

## Testing (TDD)

- `cache.test.ts`: `moveItemToGroup` with explicit `position` places exactly; without it
  appends (maxPos+1); drags subitems' `group_id` in both cases.
- `actions.test.ts`: `moveItem` honors `position` when provided, appends when omitted; still
  rejects subitems and cross-board groups.
- Insert-position helper: midpoint on both drop sides; top/bottom boundaries; container →
  undefined (append).
- `BoardTable` DnD wiring: simulate item `dragEnd` over a row in another group → asserts
  `controls.moveItemToGroup(id, targetGroup, pos)`; same-group drop → `reorderItem`; group
  header drop → `reorderGroup` (regression guard that unifying the context preserved group and
  within-group drag).

## Performance & data budget (AGENTS.md #5)

- **First paint:** unchanged; no new queries.
- **Per interaction:** in-page drag = client state + exactly one Server Action (mutates server
  data), optimistic, **0 refetch**. The unified context adds droppable refs only for
  already-mounted rows + one container per group — no new unbounded scan. Hot-path reads remain
  virtualized per group over indexed `position`.

## Files touched

- `src/lib/validations/board-actions.ts` — `moveItemSchema` gains optional `position`.
- `src/lib/boards/actions.ts` — `moveItem` honors `position`.
- `src/lib/boards/cache.ts` — `moveItemToGroup` gains optional `position`.
- `src/lib/boards/use-board-mutations.ts` — new `moveItemToGroupMutation` + `controls` method.
- `src/components/boards/BoardTable.tsx` — unify group + item drag into one board-level
  `DndContext`; container droppables; collision detection; `onDragEnd` routing; `DragOverlay`.
- Tests: `cache.test.ts`, `actions.test.ts`, insert-position helper test, `BoardTable` DnD test.

## Execution

Single-task feature (no parallel batch). Sequential critical path:
backend + cache + mutation (schema → action → cache → hook) → table DnD unification → tests
written alongside each layer (TDD). Built in a git worktree off `develop` per the working
agreement; gates (`typecheck/lint/test/build`) green before merge.

## Out of scope

- Disabling manual drag while a column sort is active (separate decision).
- Cross-group DnD in Kanban/Calendar/Gantt (Kanban already moves cards between columns via its
  own path; this spec is Table view only).
- Moving subitems between groups.
