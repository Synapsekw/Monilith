"use client";

import { memo } from "react";
import { Clock, User } from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { reorderPosition } from "@/lib/boards/group-reorder";
import type { Column } from "@/lib/boards/queries";
import {
  NAME_FREEZE_EDGE,
  NAME_FREEZE_RULE,
} from "@/components/boards/SummaryRow";
import { Kicker } from "@/components/ui/kicker";
import { AddColumnMenu } from "@/components/boards/AddColumnMenu";
import { cn } from "@/lib/utils";
import { CreatedHeaderCell } from "./CreatedHeaderCell";
import { NameResizeHandle } from "./NameResizeHandle";
import { SortableColumnHeader } from "./SortableColumnHeader";
import type { ColumnHeaderControls } from "./shared";

/**
 * The board's ONE column header: a grid on the shared column `template`,
 * rendered as the first child of the scroller's content and `sticky top-0`, so
 * the labels stay in view however far a group is scrolled.
 *
 * It owns everything column-related — the frozen "Item" cell with the
 * Name-column resize handle, one sortable {@link ColumnHeader} per board
 * column, the two Created headers and the Add-column menu. It belongs to the
 * board, not to a group, so a new, empty or collapsed group still sits under
 * the board's columns (the reason every group used to render its own header).
 *
 * 30px tall (44px on coarse pointers, where its controls are 44px targets).
 * Stacking: `z-40`, above the sticky group rows (`z-30`) and every row; below
 * the Board Total (`z-[45]`) and portalled menus (`z-50`). It needs its own
 * bottom rule: content scrolls underneath it, so there is no "next row's top
 * hairline" to rely on as there is for in-flow rows.
 *
 * Memoized: a cell edit re-renders BoardTableInner, but `columns`, `template`
 * and the `col` bundle only change on a real column change or a resize.
 */
export const BoardColumnHeader = memo(function BoardColumnHeader({
  columns,
  template,
  col,
}: {
  columns: Column[];
  template: string;
  col: ColumnHeaderControls;
}) {
  const columnSensors = useTouchAwareSensors();

  function columnMovePosition(index: number, dir: -1 | 1): number | null {
    const over = columns[index + dir];
    if (!over) return null;
    return reorderPosition(
      columns.map((c) => ({ id: c.id, position: c.position })),
      columns[index].id,
      over.id,
    );
  }

  function handleColumnDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const position = reorderPosition(
      columns.map((c) => ({ id: c.id, position: c.position })),
      String(active.id),
      String(over.id),
    );
    if (position !== null) col.reorderColumn(String(active.id), position);
  }

  return (
    <div
      data-testid="board-column-header"
      className="bg-surface text-muted-foreground border-border sticky top-0 z-40 grid h-[30px] border-b text-xs font-medium pointer-coarse:h-11"
      style={{ gridTemplateColumns: template }}
    >
      {/* Frozen "Item" cell — label + Name-column resize handle. `sticky` is
          a positioned box, so it anchors the handle and the freeze-edge
          shadow without also needing `relative` (the two conflict in cn()). */}
      <div
        className={cn(
          "bg-surface sticky left-0 z-10 flex items-center pr-2 pl-4",
          NAME_FREEZE_EDGE,
          NAME_FREEZE_RULE,
        )}
      >
        <Kicker size="xs" className="truncate">
          Item
        </Kicker>
        <NameResizeHandle
          width={col.nameWidth}
          onResize={(w) => col.setLiveNameWidth(w)}
          onResizeEnd={(w) => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(w);
          }}
          // A gesture the browser takes over (touch scroll) never reaches
          // pointerup; drop the live width so the column snaps back.
          onResizeCancel={() => col.setLiveNameWidth(null)}
          onAutoFit={() => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(null);
          }}
        />
      </div>

      {/* DndContext/SortableContext render no DOM, so headers stay direct grid
          children. The frozen Item cell before this block and the Created/Add
          cells after it sit OUTSIDE the sortable set — that is what makes the
          Name column immovable by construction. The id is fixed (one header
          per board) so aria-describedby is stable across SSR and hydration. */}
      <DndContext
        id="board-columns"
        sensors={columnSensors}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleColumnDragEnd}
      >
        <SortableContext
          items={columns.map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          {columns.map((c, i) => (
            <SortableColumnHeader
              key={c.id}
              column={c}
              col={col}
              onMoveLeft={
                i > 0
                  ? () => {
                      const p = columnMovePosition(i, -1);
                      if (p !== null) col.reorderColumn(c.id, p);
                    }
                  : null
              }
              onMoveRight={
                i < columns.length - 1
                  ? () => {
                      const p = columnMovePosition(i, 1);
                      if (p !== null) col.reorderColumn(c.id, p);
                    }
                  : null
              }
            />
          ))}
        </SortableContext>
      </DndContext>
      <CreatedHeaderCell icon={User} label="Created by" />
      <CreatedHeaderCell icon={Clock} label="Created at" />
      <AddColumnMenu onAdd={col.onAddColumn} />
    </div>
  );
});
