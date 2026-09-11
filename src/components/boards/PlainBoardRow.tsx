"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Users2 } from "lucide-react";
import type { BoardListEntry } from "@/lib/boards/queries";
import type { BoardFolder } from "@/lib/boards/folders/types";
import { cn } from "@/lib/utils";
import { BoardItemMenu } from "@/components/boards/BoardItemMenu";
import { SidebarRow, sidebarLabelClass } from "@/components/shell/sidebar-row";

/**
 * An owned-board row that is NOT a `useSortable` item (first paint, and the
 * row the drag layer wraps inside a folder). Built on `SidebarRow`: `lead` is
 * the 24px slot — an inert spacer by default, a real grip when the drag layer
 * passes one — so a row never shifts when the drag tree swaps in. Same prop
 * names as `SharedBoardRow`: one pattern for both row kinds.
 *
 * Structural drag props (ref callback, style, boolean) keep this file free of
 * @dnd-kit so it can render in the shell bundle.
 */
export function PlainBoardRow({
  board,
  isActive,
  folders = [],
  currentFolderId = null,
  lead,
  dragRef,
  isDragging = false,
  style,
}: {
  board: BoardListEntry;
  isActive: boolean;
  folders?: BoardFolder[];
  currentFolderId?: string | null;
  lead?: ReactNode;
  dragRef?: (node: HTMLElement | null) => void;
  isDragging?: boolean;
  style?: CSSProperties;
}) {
  return (
    <SidebarRow
      child
      active={isActive}
      data-board-row={board.id}
      ref={dragRef}
      style={style}
      lead={lead}
      className={cn(
        isDragging && "shadow-drag z-20",
        // Inside a folder body (pl-3) the bar must still sit on the sidebar edge.
        currentFolderId && "before:-left-5",
      )}
      trailing={
        <>
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
        </>
      }
    >
      <Link
        href={`/boards/${board.id}`}
        aria-current={isActive ? "page" : undefined}
        className={sidebarLabelClass(true)}
      >
        {board.name}
      </Link>
    </SidebarRow>
  );
}
