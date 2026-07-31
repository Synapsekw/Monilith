# Column Reordering — Design Spec

**Date:** 2026-07-03
**Feature:** MVP Final Features item 10 — drag-to-reorder board columns in the Table view.
**Product intent (verbatim):** "We need to add a feature that will allow us to move the columns,
similar to how we can move the item rows. All of the columns should be able to move, except the
first column, which is an item [the Name column]. That one is fixed and it always stays there."

---

## 1. Current state (verified in code)

- **Storage & order already exist.** `public.columns` has `position double precision not null
default 0` (`supabase/migrations/20260615061747_boards_core.sql`). The board payload query
  orders columns by `position` ascending (`src/lib/boards/queries.ts`), `createColumn` appends at
  `max(position) + 1` via `midpoint()` (`src/lib/boards/actions.ts`), and the client cache keeps
  columns position-sorted: `insertColumn` and `replaceColumn` in `src/lib/boards/cache.ts` both
  re-sort by `position`. **No schema change and no migration is needed.**
- **The reorder math is shared.** `reorderPosition()` in `src/lib/boards/group-reorder.ts` is
  shape-generic (`{ id, position }[]`) and already reused by group drag and item drag. Boundary
  drops use ±1, in-between drops use the midpoint.
- **The mutation pattern is established.** `use-board-mutations.ts` has an `optimisticColumn()`
  helper (optimistic `replaceColumn` patch + rollback + toast on error) used by rename/resize.
  Because `replaceColumn` re-sorts, patching `position` optimistically reflows the entire table
  (all group headers, all rows, footer) in one render.
- **Realtime is already wired.** `realtime-buffer.ts` folds `columns` UPDATE events through
  `replaceColumn` — other viewers' caches re-sort automatically when a position changes. Zero new
  realtime work.
- **Headers are per-group** (`GroupHeaderRow` in `src/components/boards/BoardTable.tsx`, from the
  2026-06-22 per-group-headers work). Each group renders: frozen Name/group cell (sticky,
  `NAME_FREEZE_EDGE`), then `columns.map(ColumnHeader)`, then two `CreatedHeaderCell`s
  (Created by / Created at) and `AddColumnMenu`. All groups share one `template` grid and one
  `ColumnHeaderControls` bundle, so a change from any group reflows every group. Per-group headers
  do **not** complicate a single order: columns are board-scoped, so there is exactly one order.
- **Touch/drag ergonomics are shared.** `useTouchAwareSensors()` (`src/lib/dnd/sensors.ts`) =
  PointerSensor 6px distance + TouchSensor 200ms long-press / 8px tolerance. Existing drag
  surfaces (items, groups, subitems) use a hover-reveal `GripVertical` button with
  `aria-label="Reorder <name>"`, `touch-none`, and `pointer-coarse:size-11 pointer-coarse:opacity-100`
  (44px always-visible target on coarse pointers). `restrictToVerticalAxis` /
  `restrictToHorizontalAxis` come from `@dnd-kit/modifiers` (already a dependency).
- **Other views follow for free.** Kanban card fields, Gantt, Calendar, the item panel, and
  export all consume the position-sorted `columns` array from the payload/cache — they adopt the
  new order automatically with no per-view changes.

## 2. Options considered

1. **dnd-kit drag on the column header (grip handle) + "Move left / Move right" menu items,
   persisted by a new `reorderColumn` Server Action — CHOSEN.** Mirrors item-row drag exactly
   (product ask), reuses every existing primitive (sensors, `reorderPosition`,
   `optimisticColumn`, realtime), and the menu items give a keyboard/no-drag path.
2. Menu-only ("Move left/right", no drag). Cheapest, but fails the explicit ask ("similar to how
   we can move the item rows"). Rejected as the primary interaction; kept as the accessibility
   complement.
3. Per-view column order (order stored on `board_views`). Real product idea, but scope creep:
   columns are board-scoped today, per-group headers share one template, and nothing else is
   per-view yet. Deferred — recorded in Open questions.

## 3. Design

### 3.1 Data model

No change. `columns.position` (float8) is the order; fractional midpoint insertion, matching
items/groups. Ties/precision degradation from repeated halving is the same accepted trade-off as
items and groups (no renumbering pass in MVP). Reads are already bounded: columns are fetched
once per board page load, filtered by `board_id` (indexed: `columns_board_id_idx`).

### 3.2 Server Action (the one write)

New `reorderColumn` in `src/lib/boards/actions.ts`, mirroring `reorderItem`:

```ts
export async function reorderColumn(input: {
  columnId: string;
  position: number;
}): Promise<ActionResult>;
```

- Zod at the boundary: new `reorderColumnSchema = z.object({ columnId: uuid, position: z.number() })`
  in `src/lib/validations/board-actions.ts`.
- Single round trip: `update columns set position = ? where id = ?` with
  `.select("board_id").maybeSingle()` (same shape as `reorderItem` — no separate lookup query).
- RLS is the security boundary (org-scoped, same as every column mutation). No trust in the client.
- `revalidatePath(\`/boards/${board*id}\`)` — targeted revalidation for the \_next* RSC render;
  the live session is served by the optimistic cache (gotcha-09 respected: no in-page refetch).

### 3.3 Client mutation (optimistic)

New `reorderColumnMutation` in `use-board-mutations.ts`, exposed as
`reorderColumn(columnId: string, position: number)`:

- `onMutate`: `optimisticColumn(columnId, { position })` — `replaceColumn` re-sorts, so the new
  order paints immediately everywhere (headers in every group, row cells, footer).
- `onError`: rollback snapshot + toast "Couldn't move the column — your change was undone."
- Realtime UPDATE echo is idempotent (`replaceColumn` by id).

### 3.4 Table-view UI (drag)

All inside `BoardTable.tsx` + `ColumnHeader.tsx`:

- **Per-group-header `DndContext`** (one per `GroupHeaderRow`, exactly like item drag is one per
  group): `sensors={useTouchAwareSensors()}`, `modifiers={[restrictToHorizontalAxis]}`,
  `onDragEnd={handleColumnDragEnd}`. Inside it, a `SortableContext` with
  `items={columns.map((c) => c.id)}` and `horizontalListSortingStrategy`.
- **Only data columns are sortable.** The frozen Name cell, the two `CreatedHeaderCell` built-ins,
  and `AddColumnMenu` stay outside the `SortableContext`, so the Name column is immovable at
  position 0 _by construction_ (nothing can be dropped before it or move it), and columns can
  only land within the data-column span. No "pinned item" special-casing needed.
- **`SortableColumnHeader` wrapper** (internal to `BoardTable.tsx`) owns
  `useSortable({ id: column.id })` and passes drag props into `ColumnHeader`, which stays
  presentational (its standalone tests keep passing; new props are optional). Translate-only
  transform (`CSS.Translate.toString(transform)` — gotcha-20: tracks have differing widths, never
  stretch), `transition`, and while dragging `relative bg-surface shadow-lg` (positioned so it
  paints above sibling headers but below the z-10 sticky frozen pane).
- **Grip handle** in `ColumnHeader`, rendered before the column name when drag props are provided:
  a `GripVertical` button, `aria-label={\`Reorder ${column.name} column\`}`, hover-reveal
(`opacity-0 group-hover/col:opacity-100`), `touch-none cursor-grab active:cursor-grabbing`,
and `pointer-coarse:size-11 pointer-coarse:opacity-100` (44px always-visible target on touch,
  matching the shipped TOUCH-batch ergonomics and the existing menu/resize handles in this same
  header). The resize separator and the column menu keep their own pointer handlers — the grip
  being a dedicated element avoids sensor conflicts with them.
- **Drop handler:** `handleColumnDragEnd` computes
  `reorderPosition(columns.map(({ id, position }) => ({ id, position })), activeId, overId)`
  (self-drop → null → no-op) and calls `col.reorderColumn(activeId, position)` via a new
  `reorderColumn` field on `ColumnHeaderControls`.
- **During drag** only the active group's header row animates (same scoping as item drag); on
  drop the shared cache re-sorts and every group + all rows reflow at once. dnd-kit auto-scroll
  handles dragging past the horizontal viewport edge of the shared scroll container.

### 3.5 Column menu (accessibility / no-drag path)

`ColumnHeader`'s existing dropdown gains two items above Rename: **"Move left"** and
**"Move right"** (rendered when the new optional callbacks are provided; disabled at the
respective edge — first data column can't move left, last can't move right). They swap with the
adjacent column by computing the same `reorderPosition` over the columns array. This is the
keyboard-reachable path (the dropdown is fully keyboard-accessible via Radix); a dnd-kit
KeyboardSensor is deliberately out of scope for MVP.

### 3.6 Realtime & other viewers

The single UPDATE flows through the existing buffered board channel → `applyColumn` →
`replaceColumn` → re-sort. Other viewers see the column glide to its new slot on the next
animation-frame fold. No new subscriptions, tables, or events.

### 3.7 Other views

No changes to Kanban/Gantt/Calendar/ItemPanel/Export: they already render from the
position-sorted columns array and inherit the new order.

## 4. Performance & data-fetching budget (mandatory)

| Moment                 | Server round-trips | Notes                                                                                                                                                   |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First paint            | **0 new**          | `position` is already in the board payload; nothing extra is fetched.                                                                                   |
| Drag (move events)     | **0**              | Pure client transforms (dnd-kit), no state writes until drop.                                                                                           |
| Drop                   | **exactly 1**      | One Server Action = one single-row `UPDATE … WHERE id = ?` (PK, indexed) returning `board_id`. Optimistic reorder paints before the round trip returns. |
| Move left/right (menu) | **exactly 1**      | Same single action per activation.                                                                                                                      |
| Propagation            | **0 extra**        | One realtime UPDATE event through the existing channel; `revalidatePath` only affects the next RSC render.                                              |

- Interaction changes **server data** (column order is persisted, shared state) → Server Action +
  targeted revalidation, per the working agreement. The drag _gesture_ itself is client state.
- No RSC navigation, no router refresh, no in-page refetch (gotcha-09).
- Hot-path reads: unchanged and bounded — columns are a small, board-scoped set already loaded
  once; the write is a PK-targeted single row.

## 5. UI notes (pulse-ui)

- Chrome stays monochrome: grip uses `text-muted-foreground hover:text-foreground`; drag feedback
  is `bg-surface shadow-lg` on the lifted header — no brand color, no new tokens.
- Icons: lucide `GripVertical` at `size-3.5` (dense header row), consistent with item-row grips.
- Menu items use existing `DropdownMenuItem` primitives; "Move left/right" sit above Rename,
  separated from the destructive Delete which keeps `text-destructive`.
- Focus: the grip is a real `<button>` with the global `focus-visible:ring-2 ring-ring` treatment;
  icon-only, so it carries an `aria-label`.
- Motion: dnd-kit's own transform/transition (~200ms ease-out class of feel); no Framer wrapping;
  `prefers-reduced-motion` is handled globally.
- Touch: 200ms long-press lift + 8px tolerance via the shared sensors; 44px grip hit area on
  coarse pointers (`pointer-coarse:size-11`), always visible (no hover on touch).

## 6. Error handling

- Zod-invalid input → `fail()` with the issue message (never throws to the client).
- DB error / column not found → `fail(error.message)` / "Column not found." → mutation `onError`
  rolls the cache back to the snapshot and shows the standard destructive toast.
- Self-drop and no-`over` drops are client no-ops (`reorderPosition` returns null).
- Concurrent reorders by two users: last write wins on `position`; both caches converge via the
  realtime UPDATE (same semantics as item/group reorder today).

## 7. Testing

- **Validation:** `reorderColumnSchema` accepts fractional positions, rejects non-numeric /
  non-uuid (mirrors the `reorderItemSchema` tests in `board-actions.test.ts`).
- **Action:** `reorderColumn` unit test alongside the existing column-action tests (mocked
  Supabase client; asserts the single update + `board_id` revalidate path, and `fail` paths).
- **Mutation:** `use-board-mutations.test.tsx` — optimistic position patch re-sorts
  `cache.columns`; rollback on action failure.
- **Position math:** `reorderPosition` contract test over a columns-shaped array (drop before the
  first data column → strictly less than its position; self-drop → null) — locks the reuse.
- **Component:** `ColumnHeader.test.tsx` — grip renders with `Reorder <name> column` label when
  drag props are provided (and not when omitted); "Move left/right" items render, fire callbacks,
  and are disabled at the edges. `BoardTable.test.tsx` — every group header renders a reorder
  grip per data column; no grip for Name/Created cells; drop handler wiring via the mocked
  mutations (position-math level, same style as the item-drag tests).
- **e2e (optional, if env allows):** extend the existing board spec — drag column B's grip left
  over column A, assert header order flips and persists after reload; otherwise rely on unit +
  build per the item-drag plan's precedent.

## 8. Out of scope (YAGNI)

- Per-view column order / hidden columns (see Open questions).
- Reordering or hiding the built-in trailing Created by / Created at cells.
- A dnd-kit `KeyboardSensor` for header drag (menu items cover keyboard).
- Position renumbering/compaction pass for float precision (not done for items/groups either).
- Cross-group drag semantics (columns are board-scoped; there is nothing to drag between).

## 9. Independent units (for the plan's Execution DAG)

1. **Server boundary** — schema + `reorderColumn` action (+ tests). No UI dependency.
2. **Presentational `ColumnHeader`** — optional grip + Move left/right menu (+ tests). No server
   dependency (callbacks are props).
3. **Client mutation** — `reorderColumnMutation` (+ tests). Depends on 1 (imports the action).
4. **BoardTable wiring** — DnD contexts, `SortableColumnHeader`, drop handler, controls bundle
   (+ tests). Depends on 2 and 3.

Units 1 and 2 have no shared state or ordering constraint → they are the parallel batch.

## 10. Open questions for review

1. **Per-view column order:** should each saved board view eventually carry its own column order
   (and hidden columns), like Monday? MVP persists one board-wide order; the action/UI would be
   reusable, but the storage decision (a `board_views.column_order` jsonb?) is a product call.
2. **Derived surfaces:** Kanban card fields, the item panel's field list, and Excel export will
   silently follow the new order. Assumed desirable — flag if any should keep a fixed order.
3. **Trailing built-ins:** Created by / Created at currently sit after all data columns and are
   not reorderable. Should users eventually be able to move or hide them?
4. **Permissions:** reorder is allowed for anyone RLS lets update `columns` (same as
   rename/resize/delete today). Should board _viewers_ (read-only share level) ever see the grip
   hidden client-side as a nicety? (RLS already blocks the write either way.)
5. **Keyboard drag:** is the Move left/right menu sufficient for MVP accessibility, or should a
   dnd-kit KeyboardSensor ship in a fast-follow?
