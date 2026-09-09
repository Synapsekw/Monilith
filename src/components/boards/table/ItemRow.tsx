"use client";

import { memo, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, Plus } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CreatedAtCell,
  CreatedByCell,
} from "@/components/boards/cells/created";
import type { Column, Item } from "@/lib/boards/queries";
import {
  isOverdue,
  isStatusValueComplete,
  localTodayISO,
} from "@/lib/boards/overdue";
import { cellKey, type CacheCellValue } from "@/lib/boards/cache";
import { RollupValueCell } from "@/components/boards/RollupValueCell";
import { cn } from "@/lib/utils";
import { useBoardSelection } from "@/stores/board-selection";
import { EditableCell } from "./EditableCell";
import { NameCell } from "./NameCell";
import { RowMenu } from "./RowMenu";
import { RowSelectCheckbox } from "./RowSelectCheckbox";
import {
  ROW_HEIGHT,
  cellControlsEqual,
  rowCellsEqual,
  type CellControls,
} from "./shared";

type ItemRowProps = {
  item: Item;
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  /** Whether the bulk-select checkbox is shown (editors only). */
  selectable: boolean;
  subitems: Item[];
  childCount: number;
  isExpanded: boolean;
  /** Stable toggle keyed by item id (callable as onToggleExpand(item.id)) — a
   * stable identity so this memoized row skips re-render when siblings change. */
  onToggleExpand: (id: string) => void;
  autoFocusRename: boolean;
  onRenameSettled: () => void;
  onSubitemAdded?: (id: string) => void;
};

/**
 * Row-scoped props equality.
 *
 * `cellMap` and `controls.cache` are BOARD-wide: a single cell edit (typed by
 * this user or arriving over realtime) replaces both, so default shallow memo
 * reports "changed" for every visible row and the whole grid re-renders. This
 * narrows the comparison to what the row actually renders — its own cells and
 * its subitems' (for the collapsed rollup) — leaving foreign edits to the rows
 * that own them.
 *
 * Invariant: nothing under this row may read `controls.cache.cellValues`; a
 * row's values come from `cellMap`. See CACHE_SLICES in ./shared.
 */
export function itemRowPropsEqual(
  prev: ItemRowProps,
  next: ItemRowProps,
): boolean {
  if (
    prev.item !== next.item ||
    prev.columns !== next.columns ||
    prev.template !== next.template ||
    prev.selectable !== next.selectable ||
    prev.subitems !== next.subitems ||
    prev.childCount !== next.childCount ||
    prev.isExpanded !== next.isExpanded ||
    prev.onToggleExpand !== next.onToggleExpand ||
    prev.autoFocusRename !== next.autoFocusRename ||
    prev.onRenameSettled !== next.onRenameSettled ||
    prev.onSubitemAdded !== next.onSubitemAdded
  ) {
    return false;
  }
  if (!cellControlsEqual(prev.controls, next.controls)) return false;
  const itemIds = [next.item.id, ...next.subitems.map((s) => s.id)];
  return rowCellsEqual(prev.cellMap, next.cellMap, itemIds, next.columns);
}

/** A single top-level item row: optional expand chevron, name, value cells. */
export const ItemRow = memo(function ItemRow({
  item,
  columns,
  cellMap,
  template,
  controls,
  selectable,
  subitems,
  childCount,
  isExpanded,
  onToggleExpand,
  autoFocusRename,
  onRenameSettled,
  onSubitemAdded,
}: ItemRowProps) {
  // Collapsed-parent time rollup needs a "now" for any running child entry, but
  // a bare Date.now() in render violates react-hooks/purity. Snapshot it at mount
  // via a lazy initializer (same idiom as TimeTrackingCell): the Σ of a running
  // child's elapsed time is approximate while collapsed — the live tick happens in
  // the expanded child cell — and it refreshes whenever this (virtualized) row remounts.
  const [rollupNowMs] = useState(() => Date.now());
  // Viewer-local "today" for the overdue tint, snapshotted at row mount (same
  // purity idiom as rollupNowMs; virtualized rows remount as they scroll).
  const [todayISO] = useState(() => localTodayISO());
  // Keystone selected-row treatment (periwinkle wash + 3px accent bar). Subscribes
  // to just this row's boolean membership, so toggling one row re-renders only the
  // affected (visible) rows — not the whole cache tree. Selection is top-level only.
  const selected = useBoardSelection((s) => s.selectedIds.has(item.id));
  // Priority cells only: direct-dependent counts. Computed once for the whole
  // board in BoardTableInner and threaded via `controls` (see priority.ts) —
  // not recomputed per visible row.
  const dependentsByItem = controls.dependentsByItem;
  // Completeness for the overdue tint: one lookup of this item's cell in the
  // board's first status column (resolved once per table render and threaded
  // via `controls`), instead of a filter+sort of every column and a scan of
  // every cell value on the board — per date cell, per render.
  const complete = isStatusValueComplete(
    controls.statusColumn
      ? (cellMap.get(cellKey(item.id, controls.statusColumn.id)) ?? null)
      : null,
    controls.statusColumn,
  );
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { type: "item", groupId: item.group_id },
  });

  const dragHandle = (
    <button
      type="button"
      aria-label={`Reorder ${item.name}`}
      {...attributes}
      {...listeners}
      className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/name:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
    >
      <GripVertical className="size-3.5" />
    </button>
  );

  const chevron =
    childCount > 0 ? (
      <>
        <button
          type="button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.name}`}
          aria-expanded={isExpanded}
          onClick={() => onToggleExpand(item.id)}
          className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 place-items-center rounded"
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <span className="text-muted-foreground ml-1 text-xs">
          ({childCount})
        </span>
      </>
    ) : (
      // Spacer to keep name text aligned
      <span className="inline-block size-6 shrink-0" aria-hidden />
    );

  const trailing = (
    <>
      {childCount === 0 && (
        <button
          type="button"
          aria-label={`Add subitem to ${item.name}`}
          onClick={() =>
            controls.addSubitem(item.id, "New subitem", {
              onSuccess: (id) => {
                // Expand the parent so the new subitem is visible, then
                // enter rename mode on it.
                if (!isExpanded) onToggleExpand(item.id);
                onSubitemAdded?.(id);
              },
            })
          }
          className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/name:opacity-100 focus-visible:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      )}
      <RowMenu
        label={item.name}
        hasChildren={childCount > 0}
        onDelete={() => controls.deleteItem(item.id)}
      />
    </>
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "ease-keystone border-border grid w-full border-b transition-colors",
        selected
          ? "bg-primary/[0.08]"
          : "hover:bg-foreground/[0.025] hover:border-border-hover",
        isDragging && "shadow-drag relative z-10",
      )}
      style={{
        height: ROW_HEIGHT,
        gridTemplateColumns: template,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    >
      <NameCell
        item={item}
        controls={controls}
        selected={selected}
        leading={
          <>
            {selectable && (
              <RowSelectCheckbox itemId={item.id} name={item.name} />
            )}
            {dragHandle}
            {chevron}
          </>
        }
        trailing={trailing}
        autoFocusRename={autoFocusRename}
        onRenameSettled={onRenameSettled}
      />
      {columns.map((col) => {
        if (childCount > 0 && !isExpanded) {
          return (
            <RollupValueCell
              key={col.id}
              col={col}
              items={subitems}
              cellMap={cellMap}
              cache={controls.cache}
              nowMs={rollupNowMs}
              ownValue={cellMap.get(cellKey(item.id, col.id)) ?? null}
            />
          );
        }
        const value = cellMap.get(cellKey(item.id, col.id)) ?? null;
        return (
          <EditableCell
            key={col.id}
            item={item}
            column={col}
            value={value}
            controls={controls}
            overdue={
              col.kind === "date" && isOverdue(value, todayISO) && !complete
            }
            dependents={
              col.kind === "priority"
                ? (dependentsByItem.get(item.id) ?? 0)
                : undefined
            }
          />
        );
      })}
      {/* Virtual created-by / created-at trailing cells */}
      {(() => {
        const creator = controls.members.find(
          (m) => m.userId === item.created_by,
        );
        return (
          <>
            {/* Read-only system columns — dimmed (via the cell renderers) to
                signal they can't be edited. Created-by shows the member avatar
                (from the cached board payload — first paint, no fetch). */}
            <div className="flex h-full items-center border-l px-3">
              <CreatedByCell
                name={creator?.fullName ?? creator?.email ?? null}
                avatarUrl={creator?.avatarUrl ?? null}
              />
            </div>
            <div className="flex h-full items-center border-l px-3">
              <CreatedAtCell iso={item.created_at} />
            </div>
          </>
        );
      })()}
      <div aria-hidden /> {/* add-column track spacer */}
    </div>
  );
}, itemRowPropsEqual);
