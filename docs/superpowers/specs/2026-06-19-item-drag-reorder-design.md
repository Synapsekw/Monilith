# Spec: Drag-reorder top-level items (within a group)

**Date:** 2026-06-19
**Status:** Designed — pending implementation plan
**Area:** `src/components/boards/BoardTable.tsx`

## Problem

Board **groups** and **sub-items** already support drag-to-reorder, but **top-level
items** do not. Users can drag groups and sub-items but cannot reorder the main
item rows within a group. This closes that gap.

## Scope

- **In scope:** reorder a top-level item among its siblings **in the same group**.
- **Out of scope (YAGNI, unchanged):** moving an item between groups
  (cross-group / "item-between-group drag", explicitly deferred in the Phase 6a
  spec). Drop targets are restricted to the item's own group.

## Design

This is a **front-end-only** change. The `reorderItem(itemId, position)` Server
Action and the optimistic `reorderItem` mutation already exist and are
group-agnostic (they set `items.position` with rollback + idempotent realtime
echo) — sub-item reordering already uses them. We reuse them as-is.

### Component changes (all in `BoardTable.tsx`)

1. **`GroupSection`** wraps its virtualized item list in its own `DndContext` +
   `SortableContext` (keyed by that group's item ids, `verticalListSortingStrategy`,
   `restrictToVerticalAxis`, `PointerSensor` distance 6) — nested inside the
   existing group-level `DndContext`, exactly as `SubitemBlock` nests today.
   - A local `handleItemDragEnd` computes the target position with the existing
     pure helper: `reorderPosition(items.map(i => ({ id: i.id, position: i.position })), activeId, overId)`,
     then calls `controls.reorderItem(activeId, position)` when non-null.
   - Guard `if (!over || active.id === over.id) return;` (mirrors `SubitemBlock`).

2. **`ItemRow`** becomes sortable:
   - `useSortable({ id: item.id })`.
   - Apply `transform: CSS.Translate.toString(transform)` — **not** `CSS.Transform`
     (gotcha-20: items are variable-height when expanded; scale stretches the
     absolutely-positioned virtual rows). Plus `transition` and an `isDragging`
     elevated style (`relative z-10 shadow-lg`).
   - A hover-reveal `GripVertical` handle (`{...attributes} {...listeners}`,
     `touch-none cursor-grab active:cursor-grabbing`, `aria-label={`Reorder ${item.name}`}`)
     added to the leading slot, **before** the existing chevron/spacer — matching
     the group header and sub-item row handles.

### Virtualization interaction

Top-level items are virtualized (`useVirtualizer`) inside each group's capped
(12-row) scroll viewport; sub-items are not. The sortable item id list passed to
`SortableContext` is the **full** group item list, while only the visible
(+overscan) rows mount `useSortable` nodes:

- Groups with ≤12 items render every row → drag works fully with no special
  handling.
- Larger groups: dnd-kit's built-in auto-scroll scrolls the group viewport during
  a drag past its edge, mounting further rows so collision detection continues.
- The dnd-kit drag transform is applied to the `ItemRow` root, which sits **inside**
  the virtualizer's absolutely-positioned wrapper (`translateY(vr.start)`). The two
  transforms live on different elements (wrapper = placement, ItemRow = drag), so
  they compose without conflict. The virtualizer `measureElement` ref stays on the
  wrapper; `setNodeRef` goes on the `ItemRow` root.
- Dragging an **expanded** parent moves only its own row; the indented
  `SubitemBlock` below stays in place during the drag (acceptable edge case;
  translate-only keeps row heights stable).

### Data-fetching & performance budget (AGENTS.md rule 5)

- **First paint:** unchanged — no new queries, no new server data.
- **Per interaction (drag):** **0 server round-trips** until drop. On drop, exactly
  one `reorderItem` Server Action (optimistic local reorder, targeted; no RSC
  re-run). Identical cost profile to the existing sub-item / group reorder.
- **Hot-path read:** unchanged — top-level rows remain **virtualized** and bounded
  (12-row viewport); we do not drop virtualization. `items.position` is the
  existing indexed ordering column.

## Testing

Follows the existing board test patterns (`BoardTable.test.tsx` + e2e).

- **Unit/component:** an item row exposes a "Reorder {name}" drag handle; a
  simulated drag-end over a sibling calls `reorderItem` with the position computed
  by `reorderPosition` (reuse the pure-helper coverage already in place).
- **Guard:** dropping an item on itself (`active.id === over.id`) does **not** call
  `reorderItem`.
- **Scope:** the sortable context is per group — an item's drag does not target
  rows in another group.
- **e2e (extend existing board flow):** create two items in a group → drag the
  second above the first → assert new visual order persists (optimistic) and the
  reorder action fired.

All of `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` must pass.

## Risks / notes

- dnd-kit + virtualization auto-scroll across a long group is the only nontrivial
  interaction; mitigated by the 12-row viewport cap (most groups render fully) and
  dnd-kit's native auto-scroll. Covered by gotcha-20 for the transform pitfall.
- Two nested `DndContext` layers per group (group-level outer, item-level inner)
  plus the sub-item `DndContext` — this nesting already ships for sub-items and is
  a supported dnd-kit pattern.
