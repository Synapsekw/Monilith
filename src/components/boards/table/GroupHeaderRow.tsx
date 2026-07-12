"use client";

import {
  ChevronDown,
  ChevronRight,
  Clock,
  GripVertical,
  User,
} from "lucide-react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { reorderPosition } from "@/lib/boards/group-reorder";
import type { Column, Group } from "@/lib/boards/queries";
import { NAME_FREEZE_EDGE } from "@/components/boards/SummaryRow";
import { Input } from "@/components/ui/input";
import { Kicker } from "@/components/ui/kicker";
import { AddColumnMenu } from "@/components/boards/AddColumnMenu";
import { cn } from "@/lib/utils";
import { CreatedHeaderCell } from "./CreatedHeaderCell";
import { GroupMenu } from "./GroupMenu";
import { NameResizeHandle } from "./NameResizeHandle";
import { SortableColumnHeader } from "./SortableColumnHeader";
import type { ColumnHeaderControls } from "./shared";

/**
 * A group's header row (Monday-style): a grid aligned to the shared column
 * `template`, with the group controls in a frozen Name cell and an interactive
 * {@link ColumnHeader} per board column + {@link AddColumnMenu}. Rendered by
 * EVERY group (there is no single global header), so empty/new groups still
 * show the board's columns. Column width/options/dialog state is shared via
 * {@link ColumnHeaderControls} so a change from any group reflows all groups.
 */
export function GroupHeaderRow({
  group,
  groupIndex,
  columns,
  template,
  selectAll,
  collapsed,
  onToggleCollapse,
  renaming,
  name,
  onNameChange,
  onCommitRename,
  onCancelRename,
  onOpenRename,
  itemCount,
  dragAttributes,
  dragListeners,
  onSetColor,
  onDelete,
  col,
}: {
  group: Group;
  /** Zero-based position among visible groups — powers the Keystone head kicker. */
  groupIndex: number;
  columns: Column[];
  template: string;
  /** Group-header "select all visible" checkbox, or null for viewers/empty groups. */
  selectAll: React.ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  renaming: boolean;
  name: string;
  onNameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpenRename: () => void;
  itemCount: number;
  dragAttributes: ReturnType<typeof useSortable>["attributes"];
  dragListeners: ReturnType<typeof useSortable>["listeners"];
  onSetColor: (color: string) => void;
  onDelete: () => void;
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
      className="group/grouphdr bg-surface text-muted-foreground grid border-b text-xs font-medium"
      style={{ gridTemplateColumns: template }}
    >
      {/* Frozen group/Name cell — group controls + Name-column resize handle. */}
      <div
        className={cn(
          "bg-surface text-foreground relative sticky left-0 z-10 flex items-center gap-2 px-3 py-1.5 text-sm font-semibold",
          NAME_FREEZE_EDGE,
        )}
        style={{ boxShadow: `inset 3px 0 0 0 ${group.color}` }}
      >
        {selectAll}
        <button
          type="button"
          aria-label={`Reorder ${group.name}`}
          {...dragAttributes}
          {...dragListeners}
          className="text-muted-foreground hover:text-foreground grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
          aria-hidden
        />
        {renaming ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename();
              }
            }}
            aria-label={`Rename ${group.name}`}
            className="h-7 max-w-xs"
          />
        ) : (
          <button
            type="button"
            onClick={onOpenRename}
            aria-label={group.name}
            className="focus-visible:ring-ring min-w-0 truncate rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            {/* Keystone group head: mono "NN / NAME" kicker; the first group
                reads bright, the rest dim — hierarchy by weight/tone, not color
                (title text stays monochrome). */}
            <Kicker
              index={String(groupIndex + 1).padStart(2, "0")}
              className={cn(
                "truncate",
                groupIndex === 0 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {group.name}
            </Kicker>
          </button>
        )}
        <span className="text-muted-foreground text-xs font-normal">
          {itemCount}
        </span>
        <GroupMenu
          group={group}
          onRename={onOpenRename}
          onSetColor={onSetColor}
          onDelete={onDelete}
        />
        <NameResizeHandle
          width={col.nameWidth}
          onResize={(w) => col.setLiveNameWidth(w)}
          onResizeEnd={(w) => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(w);
          }}
          onAutoFit={() => {
            col.setLiveNameWidth(null);
            col.resizeNameColumn(null);
          }}
        />
      </div>

      {/* DndContext/SortableContext render no DOM, so headers stay direct
          grid children. The frozen Name cell before this block and the
          Created/Add cells after it sit OUTSIDE the sortable set — that is
          what makes the Name column immovable by construction. */}
      <DndContext
        id={`group-columns-${group.id}`}
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
}
