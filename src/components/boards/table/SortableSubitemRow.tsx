"use client";

import { memo, useState } from "react";
import { GripVertical } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { EditableCell } from "./EditableCell";
import { NameCell } from "./NameCell";
import { RowMenu } from "./RowMenu";
import {
  ROW_HEIGHT,
  cellControlsEqual,
  rowCellsEqual,
  type CellControls,
} from "./shared";

type SubitemRowProps = {
  sub: Item;
  columns: Column[];
  cellMap: Map<string, CacheCellValue["value"]>;
  template: string;
  controls: CellControls;
  renamingItemId: string | null;
  onRenameSettled: () => void;
};

/**
 * Every prop {@link subitemRowPropsEqual} inspects, listed once. `cellMap`,
 * `controls` and `renamingItemId` are named here but handled specially.
 */
const SUBITEM_ROW_PROPS = [
  "sub",
  "columns",
  "cellMap",
  "template",
  "controls",
  "renamingItemId",
  "onRenameSettled",
] as const satisfies readonly (keyof SubitemRowProps)[];

/** Compile-time guard — see the equivalent in ./ItemRow. */
type UnhandledSubitemRowProp = Exclude<
  keyof SubitemRowProps,
  (typeof SUBITEM_ROW_PROPS)[number]
>;
const _subitemRowPropsExhaustive: [UnhandledSubitemRowProp] extends [never]
  ? true
  : UnhandledSubitemRowProp = true;
void _subitemRowPropsExhaustive;

/** Row-scoped props equality — see `itemRowPropsEqual` in ./ItemRow. */
export function subitemRowPropsEqual(
  prev: SubitemRowProps,
  next: SubitemRowProps,
): boolean {
  for (const key of SUBITEM_ROW_PROPS) {
    if (key === "cellMap" || key === "controls" || key === "renamingItemId")
      continue;
    if (!Object.is(prev[key], next[key])) return false;
  }
  // Only this row's rename flag matters; another row entering rename mode must
  // not re-render it.
  if (
    (prev.renamingItemId === next.sub.id) !==
    (next.renamingItemId === next.sub.id)
  ) {
    return false;
  }
  if (!cellControlsEqual(prev.controls, next.controls)) return false;
  return rowCellsEqual(prev.cellMap, next.cellMap, [next.sub.id], next.columns);
}

/** A single sortable subitem row inside a `SubitemBlock`. */
export const SortableSubitemRow = memo(function SortableSubitemRow({
  sub,
  columns,
  cellMap,
  template,
  controls,
  renamingItemId,
  onRenameSettled,
}: SubitemRowProps) {
  // Viewer-local "today" for the overdue tint, snapshotted at row mount (same
  // purity idiom as ItemRow's rollupNowMs).
  const [todayISO] = useState(() => localTodayISO());
  // Priority cells only: direct-dependent counts, computed once for the whole
  // board in BoardTableInner and threaded via `controls` (see priority.ts).
  const dependentsByItem = controls.dependentsByItem;
  // O(1) completeness for the overdue tint — see the note in ItemRow.
  const complete = isStatusValueComplete(
    controls.statusColumn
      ? (cellMap.get(cellKey(sub.id, controls.statusColumn.id)) ?? null)
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
  } = useSortable({ id: sub.id });

  const dragHandle = (
    <button
      type="button"
      aria-label={`Reorder ${sub.name}`}
      {...attributes}
      {...listeners}
      className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/name:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
    >
      <GripVertical className="size-3.5" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        // CSS.Translate (not CSS.Transform) — drops the scale so variable-height
        // rows don't stretch/squish during drag (gotcha-20).
        transform: CSS.Translate.toString(transform),
        transition,
        height: ROW_HEIGHT,
        gridTemplateColumns: template,
      }}
      className={cn(
        "ease-keystone border-border hover:border-border-hover hover:bg-foreground/[0.025] grid w-full border-b transition-colors",
        isDragging && "shadow-drag relative z-10",
      )}
    >
      <NameCell
        item={sub}
        controls={controls}
        leading={dragHandle}
        indented
        autoFocusRename={sub.id === renamingItemId}
        onRenameSettled={onRenameSettled}
        trailing={
          <RowMenu
            label={sub.name}
            hasChildren={false}
            onDelete={() => controls.deleteItem(sub.id)}
          />
        }
      />
      {columns.map((col) => {
        const value = cellMap.get(cellKey(sub.id, col.id)) ?? null;
        return (
          <EditableCell
            key={col.id}
            item={sub}
            column={col}
            value={value}
            controls={controls}
            overdue={
              col.kind === "date" && isOverdue(value, todayISO) && !complete
            }
            dependents={
              col.kind === "priority"
                ? (dependentsByItem.get(sub.id) ?? 0)
                : undefined
            }
          />
        );
      })}
      {/* Virtual created-by / created-at trailing cells */}
      {(() => {
        const creator = controls.members.find(
          (m) => m.userId === sub.created_by,
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
              <CreatedAtCell iso={sub.created_at} />
            </div>
          </>
        );
      })()}
      <div aria-hidden />
    </div>
  );
}, subitemRowPropsEqual);
