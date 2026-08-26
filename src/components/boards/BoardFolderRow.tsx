"use client";

import { useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { BoardFolderMenu } from "@/components/boards/BoardFolderMenu";

/**
 * One collapsible folder in the Boards nav. Open/closed state reuses
 * `useUIStore.collapsedSections` (the same persisted map `NavSection` uses),
 * keyed `folder:<id>` — so toggling a folder is 0 server round-trips and
 * survives a reload. Default open (absent key).
 *
 * The row can also be a drag drop target, but it deliberately imports nothing
 * from @dnd-kit: the `useDroppable` hook is called by the lazy drag layer
 * (`BoardsNavSortable`), which passes its `setNodeRef` and `isOver` down as
 * `dropRef` / `isOver`. That keeps the ~30-40KB dnd stack out of the shell
 * bundle that every authenticated route pays for.
 */
export function BoardFolderRow({
  folder,
  count,
  dropRef,
  isOver = false,
  children,
}: {
  folder: { id: string; name: string };
  count: number;
  dropRef?: (node: HTMLElement | null) => void;
  isOver?: boolean;
  children: ReactNode;
}) {
  const collapsedSections = useUIStore((s) => s.collapsedSections);
  const toggleSection = useUIStore((s) => s.toggleSection);
  const key = `folder:${folder.id}`;
  const open = !collapsedSections[key];
  const bodyId = `board-folder-${folder.id}`;

  // Hovering a dragged board over a CLOSED folder opens it, so the drop lands
  // somewhere the user can actually see. Same client-only persisted toggle a
  // click uses — no server round-trip, so this is not the gotcha-09 shape.
  useEffect(() => {
    if (isOver && !open) toggleSection(key);
  }, [isOver, open, key, toggleSection]);

  return (
    <div className="flex flex-col gap-0.5">
      <div
        ref={dropRef}
        // Focus anchor for the plain→drag subtree swap. Folder rows render
        // FIRST in the section, so the chevron is the first focusable thing a
        // Tab reaches — without this the very first Tab into Boards lands on
        // <body>. See `boards-nav-focus.ts`.
        data-folder-row={folder.id}
        data-testid={dropRef ? `folder-drop-${folder.id}` : undefined}
        className={cn(
          "group/folder text-muted-foreground hover:bg-state-hover hover:text-foreground flex items-center rounded-md pr-1 transition-colors",
          isOver && "bg-state-hover ring-primary/60 text-foreground ring-1",
        )}
      >
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
          className="flex size-6 shrink-0 items-center justify-center rounded"
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        {open ? (
          <FolderOpen className="mr-1.5 size-3.5 shrink-0" aria-hidden />
        ) : (
          <Folder className="mr-1.5 size-3.5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => toggleSection(key)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="min-w-0 flex-1 truncate py-1 pr-1 text-left text-xs"
        >
          {folder.name}
        </button>
        {/* Decorative: a screen reader would otherwise announce a bare number
            with no unit after the folder name, and the expanded list of boards
            is right there. */}
        <span
          aria-hidden
          className="text-3xs text-muted-foreground mr-0.5 shrink-0 tabular-nums"
        >
          {count}
        </span>
        <BoardFolderMenu folder={folder} />
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-0.5 pl-3">
        {children}
      </div>
    </div>
  );
}
