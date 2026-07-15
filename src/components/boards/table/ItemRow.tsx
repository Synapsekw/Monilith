"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, Plus } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CreatedAtCell,
  CreatedByCell,
} from "@/components/boards/cells/created";
import type { Column, Item } from "@/lib/boards/queries";
import { isItemComplete, isOverdue, localTodayISO } from "@/lib/boards/overdue";
import { buildDependentsCountMap } from "@/lib/boards/priority";
import { cellKey, type CacheCellValue } from "@/lib/boards/cache";
import { RollupValueCell } from "@/components/boards/RollupValueCell";
import { cn } from "@/lib/utils";
import { useBoardSelection } from "@/stores/board-selection";
import { EditableCell } from "./EditableCell";
import { NameCell } from "./NameCell";
import { RowMenu } from "./RowMenu";
import { RowSelectCheckbox } from "./RowSelectCheckbox";
import { ROW_HEIGHT, type CellControls } from "./shared";

/** A single top-level item row: optional expand chevron, name, value cells. */
export function ItemRow({
  item,
  columns,
  cellMap,
  template,
  controls,
  selectable,
  subitems,
  childCount,
  isExpanded,
  onToggle,
  autoFocusRename,
  onRenameSettled,
  onSubitemAdded,
}: {
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
  onToggle: () => void;
  autoFocusRename: boolean;
  onRenameSettled: () => void;
  onSubitemAdded?: (id: string) => void;
}) {
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
  // Priority cells only: direct-dependent counts derived from the cached
  // dependency edges (one O(E) pass — see @/lib/boards/priority; overdue-tint
  // precedent: render-time signal, nothing persisted, 0 extra round-trips).
  const dependentsByItem = useMemo(
    () => buildDependentsCountMap(controls.cache.dependencies),
    [controls.cache.dependencies],
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
          onClick={onToggle}
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
                if (!isExpanded) onToggle();
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
        isDragging && "relative z-10 shadow-lg",
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
              col.kind === "date" &&
              isOverdue(value, todayISO) &&
              !isItemComplete(item.id, columns, controls.cache.cellValues)
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
}
