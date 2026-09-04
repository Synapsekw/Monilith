"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Users2 } from "lucide-react";
import type { BoardListEntry } from "@/lib/boards/queries";
import type { BoardFolder } from "@/lib/boards/folders/types";
import { cn } from "@/lib/utils";
import { BoardItemMenu } from "@/components/boards/BoardItemMenu";

/**
 * An owned-board row that is NOT a `useSortable` item: the default first-paint
 * markup before the lazy sortable variant mounts, and — inside a folder — the
 * row the drag layer wraps too. Mirrors `SortableBoardRow` minus the sortable
 * hooks.
 *
 * `leading` is the 24px grip slot: an inert spacer by default, a real drag
 * handle when the drag layer passes one. Reserving it unconditionally is what
 * keeps a row from shifting horizontally when the drag tree swaps in, and is
 * what the "folder row alignment" tests pin. Same contract, same prop names, as
 * `SharedBoardRow` — one pattern for both row kinds, not two.
 *
 * The drag props are deliberately structural (a ref callback, a style, a
 * boolean), so this component stays free of @dnd-kit and can render in the
 * shell bundle.
 */
export function PlainBoardRow({
  board,
  isActive,
  folders = [],
  currentFolderId = null,
  leading = <span className="size-6 shrink-0" aria-hidden />,
  dragRef,
  isDragging = false,
  style,
}: {
  board: BoardListEntry;
  isActive: boolean;
  folders?: BoardFolder[];
  currentFolderId?: string | null;
  leading?: ReactNode;
  dragRef?: (node: HTMLElement | null) => void;
  isDragging?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      data-board-row={board.id}
      ref={dragRef}
      style={style}
      className={cn(
        "group/row flex items-center rounded-md pr-1 transition-colors",
        isDragging && "relative z-20 shadow-lg",
        isActive
          ? "bg-primary/80 text-foreground"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      {leading}
      <Link
        href={`/boards/${board.id}`}
        aria-current={isActive ? "page" : undefined}
        className="min-w-0 flex-1 truncate py-1 pr-1 text-xs"
      >
        {board.name}
      </Link>
      {board.shared_out ? (
        <Users2
          aria-label="Shared with others"
          className="text-muted-foreground mr-0.5 size-3.5 shrink-0"
        />
      ) : null}
      <BoardItemMenu
        board={{ id: board.id, name: board.name }}
        isActive={isActive}
        folders={folders}
        currentFolderId={currentFolderId}
      />
    </div>
  );
}
