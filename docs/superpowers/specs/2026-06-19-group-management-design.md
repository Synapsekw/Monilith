# Group Management — Design (reorder · color · delete)

**Date:** 2026-06-19
**Status:** Approved (pending spec review)
**Area:** Boards (Table view) — board groups
**Follows:** `2026-06-19-add-group-design.md` (add-group shipped; this completes group CRUD)

## Problem

Board groups can now be created and renamed, but cannot be **reordered**, **recolored**, or **deleted**. The data model already supports all three (`groups.position` float8, `groups.color` hex, `items.group_id ... on delete cascade`), and the realtime handler already reconciles group INSERT/UPDATE/DELETE. This spec wires the three remaining operations into the UI following the established board patterns.

## Goals

- Drag-to-reorder groups within a board (vertical).
- Change a group's color from a fixed brand palette.
- Delete a group (with confirmation); its items cascade-delete.

## Non-goals (YAGNI)

- Multi-select / bulk group operations.
- Dragging **items** between groups (separate, larger feature).
- Custom hex color entry beyond the palette.
- Preventing deletion of the last group (allowed — board falls back to the existing empty state + Add group).

## Approach

Mirror existing board patterns throughout: optimistic mutations + rollback (like `renameGroup`/`deleteColumn`), the `ColumnHeader` DropdownMenu + AlertDialog for the menu/confirm, and the Kanban dnd-kit setup for drag. `@dnd-kit/core@6`, `@dnd-kit/sortable@10`, `@dnd-kit/modifiers@9`, `@dnd-kit/utilities@3` are already installed.

### 1. Cache ordering — groups become position-sorted (`src/lib/boards/cache.ts`)

Today `insertGroup` appends and `replaceGroup` maps-in-place — neither sorts. Reorder requires the cache to honor `position`, so groups adopt the same approach columns already use (`insertColumn`/`replaceColumn` both sort via `byPosition`):

- Add `function byGroupPosition(a: CacheGroup, b: CacheGroup) { return a.position - b.position; }`.
- `insertGroup`: append (idempotent on id) **then** `.sort(byGroupPosition)` — mirror `insertColumn`.
- `replaceGroup`: map-by-id **then** `.sort(byGroupPosition)` — mirror `replaceColumn`.
- New `removeGroup(cache, groupId)`: filter the group out **and cascade** — drop its items and those items' cell values (mirrors the DB `on delete cascade`):

```ts
/** Remove a group and its items + their cell values (mirrors the DB cascade). Immutable. */
export function removeGroup(cache: BoardCache, groupId: string): BoardCache {
  const itemIds = new Set(
    cache.items.filter((i) => i.group_id === groupId).map((i) => i.id),
  );
  return {
    ...cache,
    groups: cache.groups.filter((g) => g.id !== groupId),
    items: cache.items.filter((i) => i.group_id !== groupId),
    cellValues: cache.cellValues.filter((c) => !itemIds.has(c.item_id)),
  };
}
```

Sorting is harmless for add/rename (positions unchanged → stable order). It also makes a **peer's reorder reflect via realtime**, because the realtime group-UPDATE path calls `replaceGroup`.

**Existing-test update:** the add-group `insertGroup` tests use fixtures without `position`. They get a `position` field and assert position order (not insertion order).

### 2. Realtime (`src/lib/boards/use-board-realtime.ts`)

The `onGroup` INSERT branch currently appends inline (`{ ...prev, groups: [...prev.groups, row] }`). Change it to use `insertGroup(prev, row)` so realtime inserts are position-sorted and idempotent, consistent with the UPDATE branch's `replaceGroup`. DELETE branch is unchanged (filter by id; item cascade for a remote delete arrives as separate item DELETE echoes, and a full reload reconciles regardless).

### 3. Validation (`src/lib/validations/board-actions.ts`)

```ts
export const deleteGroupSchema = z.object({ groupId: uuid });
export const reorderGroupSchema = z.object({
  groupId: uuid,
  position: z.number(),
});
export const updateGroupColorSchema = z.object({
  groupId: uuid,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color"),
});
```

### 4. Server Actions (`src/lib/boards/actions.ts`)

Three actions, each `"use server"`, Zod-validated, RLS-scoped, ending in `revalidatePath(\`/boards/${boardId}\`)`. They mirror `renameGroup`(which already does`.update().eq(id).select("board_id").maybeSingle()` to derive the board for revalidation):

- `reorderGroup({ groupId, position })` → `update({ position })`.
- `updateGroupColor({ groupId, color })` → `update({ color })`.
- `deleteGroup({ groupId })` → `.delete().eq("id", groupId).select("board_id").maybeSingle()`; items cascade in the DB. Returns `ActionResult` (void data).

Each returns `fail("Group not found.")` when `maybeSingle()` yields no row (missing or RLS-hidden), matching `renameGroup`.

### 5. Optimistic mutations (`src/lib/boards/use-board-mutations.ts`)

All three follow the optimistic-`onMutate` + rollback-`onError` shape already used by `renameGroupMutation` / `deleteColumnMutation`:

- `reorderGroupMutation` (`{ groupId, position }`): `onMutate` → `replaceGroup(prev, { ...group, position })` (re-sorts); rollback on error. Exposed as `reorderGroup(groupId, position)`.
- `setGroupColorMutation` (`{ groupId, color }`): `onMutate` → `replaceGroup(prev, { ...group, color })`; rollback. Exposed as `setGroupColor(groupId, color)`.
- `deleteGroupMutation` (`{ groupId }`): `onMutate` → `removeGroup(prev, groupId)`; rollback. Exposed as `deleteGroup(groupId)`.

(No callbacks needed; realtime echoes are idempotent — `replaceGroup` by id, `removeGroup` filter by id.)

### 6. Color palette (`src/lib/boards/group-colors.ts` — new)

A single canonical swatch list, so the UI doesn't reach into template internals:

```ts
/** Canonical group color swatches: the default board blue + the 11 brand colors
 *  shared with Status/Dropdown options. */
export const GROUP_COLORS = [
  "#0073ea", // default board blue
  "#00c875",
  "#fdab3d",
  "#e2445c",
  "#c4c4c4",
  "#808080",
  "#6366f1",
  "#8b5cf6",
  "#38bdf8",
  "#ec4899",
  "#14b8a6",
  "#f97316",
] as const;
```

### 7. Group header menu (`src/components/boards/BoardTable.tsx`)

A new `GroupMenu` piece (or inline within `GroupSection`) renders a `MoreHorizontal` trigger on the right of the header (after the item count), shown on hover via the `group/…` opacity pattern from `ColumnHeader`. Menu contents:

- **Rename** — sets the existing `renaming` state true (reuses the inline name input already in `GroupSection`).
- **Set color** — an inline swatch grid rendered directly inside `DropdownMenuContent` (a non-menuitem `<div>` of swatch `<button>`s mapped from `GROUP_COLORS`; the current `group.color` swatch shows a ring). Clicking a swatch calls `setGroupColor(group.id, color)` and closes the menu. Inline grid avoids depending on `DropdownMenuSub` primitives.
- **Delete** (`text-destructive`) → opens an `AlertDialog`: title _"Delete '{group.name}'?"_, body _"This permanently deletes the group and all of its items on this board. This can't be undone."_, Cancel + destructive Delete → `deleteGroup(group.id)`.

The existing color dot + colored left rail already read from `group.color`, so a color change reflects immediately via the optimistic `replaceGroup`.

### 8. Drag-to-reorder (`src/components/boards/BoardTable.tsx`)

- In `BoardTable`, wrap the rendered groups in `<DndContext>` (one `PointerSensor`, `activationConstraint: { distance: 6 }` like Kanban; `modifiers={[restrictToVerticalAxis]}`) and `<SortableContext items={groupIds} strategy={verticalListSortingStrategy}>` where `groupIds = groups.map(g => g.id)`.
- `GroupSection` calls `useSortable({ id: group.id })` and applies `transform`/`transition` (via `@dnd-kit/utilities` `CSS.Transform.toString`) to its root `<section>`, plus a small opacity/elevation while dragging.
- A dedicated **drag handle** (`GripVertical`, far left of the header) receives `attributes` + `listeners`. Nothing else in the header/body gets drag listeners, so collapse, rename, the menu, and the inner item scroll are unaffected.
- On drop, `BoardTable`'s `onDragEnd` computes the new position with a **pure, unit-tested helper**:

```ts
// src/lib/boards/group-reorder.ts (new)
import { midpoint } from "@/lib/boards/position";
/** Given the current position-ordered group ids and a move (activeId over overId),
 *  return the new float position for activeId, or null for a no-op. */
export function reorderPosition(
  groups: { id: string; position: number }[],
  activeId: string,
  overId: string,
): number | null {
  if (activeId === overId) return null;
  const from = groups.findIndex((g) => g.id === activeId);
  const to = groups.findIndex((g) => g.id === overId);
  if (from === -1 || to === -1) return null;
  const without = groups.filter((g) => g.id !== activeId);
  // `to` is an index into the original (position-ordered) array; `without`
  // excludes the active group, so `to` is also the slot the active group should
  // occupy in `without` — correct whether moving up or down (verified by tests).
  const before = without[to - 1]?.position ?? null;
  const after = without[to]?.position ?? null;
  return midpoint(before, after);
}
```

`onDragEnd` then calls `reorderGroup(activeId, position)` when the helper returns non-null. The four directional cases (move down, up, to top, to bottom) plus the same-id no-op are pinned by `group-reorder.test.ts`.

### 9. Data-fetching budget (AGENTS.md rule 5)

- **First paint:** unchanged.
- **Interactions:** reorder / color / delete all change **server data** → Server Action + optimistic cache patch, **0 RSC navigations**, no refetch (realtime + `revalidatePath`).
- **Bounded:** reorder and color are single-row updates; delete is one row with a DB-side item cascade — no client-side list re-read.

## Testing (TDD)

- `cache.test.ts`: `insertGroup` and `replaceGroup` keep groups in `position` order (incl. updating the existing add-group fixtures to carry positions); `removeGroup` drops the group, its items, and those items' cell values, immutably.
- `group-reorder.test.ts`: `reorderPosition` for move-down, move-up, move-to-top, move-to-bottom, and the same-id no-op (returns null).
- `use-board-mutations.test.tsx`: `reorderGroup` (optimistic position + re-sort, rollback on `{ ok:false }`), `setGroupColor` (optimistic color, rollback), `deleteGroup` (optimistic remove incl. items, rollback).
- `BoardTable.test.tsx`: the `⋯` menu opens; clicking a swatch calls `setGroupColor` with that hex; Delete → confirm → calls `deleteGroup`. (Drag itself isn't simulated; the position math is covered by `group-reorder.test.ts`.)
- Full gate before done: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Risks / edge cases

- **Drag vs. click conflict** — the `distance: 6` PointerSensor activation (same as Kanban) keeps the handle from swallowing clicks; only the handle carries listeners.
- **Reorder math off-by-one** — isolated in `reorderPosition` and pinned by directional tests rather than relying on drag simulation.
- **Delete cascade in cache** — `removeGroup` must also purge the deleted items' cell values, or stale cells linger; covered by a cascade test.
- **Last-group delete** — intentionally allowed; `BoardTable` already renders the "no groups yet" empty state + Add group when `groups.length === 0`.
- **Realtime ordering for peers** — addressed by making `insertGroup`/`replaceGroup` sort and routing the realtime INSERT through `insertGroup`.
