"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

const MIN = 80;
const MAX = 1200;

export function ColumnHeader({
  column,
  width,
  onRename,
  onDelete,
  onResize,
  onResizeEnd,
  onEditOptions,
}: {
  column: CacheColumn;
  width: number;
  onRename: (name: string) => void;
  onDelete: () => void;
  onResize: (width: number) => void; // live, each drag move (updates liveWidths)
  onResizeEnd: (width: number) => void; // on release (persists via resizeColumn)
  onEditOptions?: () => void; // open the option editor (status/dropdown only)
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
    <div className="group/col relative flex items-center gap-1 border-l px-3 py-1.5">
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
          <span className="truncate">{column.name}</span>
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
              {COLUMN_KIND_META[column.kind]?.hasOptions && onEditOptions && (
                <DropdownMenuItem onSelect={() => onEditOptions()}>
                  Edit labels
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
