"use client";

import { useState } from "react";
import { GripVertical, MoreHorizontal } from "lucide-react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import type { CacheColumn } from "@/lib/boards/cache";
import { COLUMN_KIND_META } from "@/lib/boards/column-kinds";
import { clampDragWidth } from "@/lib/boards/name-column-width";
import { cn } from "@/lib/utils";

const MIN = 80;
const MAX = 1200;

/**
 * Drag/reorder wiring passed down by the owning sortable wrapper (the header
 * itself stays presentational). `onMoveLeft`/`onMoveRight` are the menu-based
 * keyboard path; null = disabled at that edge.
 */
export type ColumnReorder = {
  setNodeRef: (el: HTMLDivElement | null) => void;
  style: React.CSSProperties; // translate-only transform + transition
  isDragging: boolean;
  handleAttributes: DraggableAttributes;
  handleListeners: DraggableSyntheticListeners;
  onMoveLeft: (() => void) | null; // null = disabled (first data column)
  onMoveRight: (() => void) | null; // null = disabled (last data column)
};

export function ColumnHeader({
  column,
  width,
  onRename,
  onDelete,
  onResize,
  onResizeEnd,
  onEditOptions,
  onEditCurrency,
  onSmartFill,
  reorder,
}: {
  column: CacheColumn;
  width: number;
  onRename: (name: string) => void;
  onDelete: () => void;
  onResize: (width: number) => void; // live, each drag move (updates liveWidths)
  onResizeEnd: (width: number) => void; // on release (persists via resizeColumn)
  onEditOptions?: () => void; // open the option editor (status/dropdown only)
  onEditCurrency?: () => void; // open the currency picker (currency kind only)
  onSmartFill?: () => void; // open the Smart Fill dialog (text columns only)
  reorder?: ColumnReorder; // drag + move-left/right affordances (optional)
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(column.name);

  function commitRename() {
    const v = draft.trim();
    if (v && v !== column.name) onRename(v);
    setEditing(false);
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = width;
    const move = (ev: PointerEvent) => {
      last = clampDragWidth(startW + (ev.clientX - startX), MIN, MAX);
      onResize(last); // live
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd(last); // persist the final width
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={reorder?.setNodeRef}
      style={reorder?.style}
      className={cn(
        "group/col relative flex items-center gap-1 border-l px-3 py-1.5",
        reorder?.isDragging && "bg-surface z-auto shadow-lg",
      )}
    >
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-6 px-1 text-xs"
          aria-label="Column name"
        />
      ) : (
        <>
          {reorder && (
            <button
              type="button"
              aria-label={`Reorder ${column.name} column`}
              {...reorder.handleAttributes}
              {...(reorder.handleListeners ?? {})}
              className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded opacity-0 transition-opacity group-hover/col:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-100"
            >
              <GripVertical className="size-3.5" />
            </button>
          )}
          <span className="text-kicker text-3xs truncate font-mono font-medium tracking-[0.12em] uppercase">
            {column.name}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`${column.name} column menu`}
                className="text-muted-foreground hover:text-foreground ml-auto grid place-items-center opacity-0 transition-opacity group-hover/col:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {reorder && (
                <>
                  <DropdownMenuItem
                    disabled={!reorder.onMoveLeft}
                    onSelect={() => reorder.onMoveLeft?.()}
                  >
                    Move left
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!reorder.onMoveRight}
                    onSelect={() => reorder.onMoveRight?.()}
                  >
                    Move right
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {COLUMN_KIND_META[column.kind]?.hasOptions && onEditOptions && (
                <DropdownMenuItem onSelect={() => onEditOptions()}>
                  Edit labels
                </DropdownMenuItem>
              )}
              {column.kind === "text" && onSmartFill && (
                <DropdownMenuItem onSelect={() => onSmartFill()}>
                  Smart fill…
                </DropdownMenuItem>
              )}
              {column.kind === "currency" && onEditCurrency && (
                <DropdownMenuItem onSelect={() => onEditCurrency()}>
                  Change currency
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  setDraft(column.name);
                  setEditing(true);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => setConfirming(true)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Resize handle on the right edge. The visible feedback is a 4px line
          (the `before:` pseudo, hidden until hover on fine pointers). On a
          coarse pointer the *hit area* grows to a 44px-wide band centred on the
          edge (`-right-5` = -1.25rem so 44px straddles the 4px line) while the
          visible line stays 4px; `touch-none` keeps a resize drag from
          scrolling the table. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${column.name}`}
        onPointerDown={onPointerDown}
        className="hover:before:bg-primary/40 absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none before:absolute before:inset-y-0 before:right-0 before:w-1 before:bg-transparent pointer-coarse:-right-5 pointer-coarse:w-11"
      />

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{column.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the column and all of its data on this
              board. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
