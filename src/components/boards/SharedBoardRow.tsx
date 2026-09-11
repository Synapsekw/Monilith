"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Eye, Users2 } from "lucide-react";
import type { SharedBoardEntry } from "@/lib/boards/queries";
import type { BoardFolder } from "@/lib/boards/folders/types";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SharedBoardMenu } from "@/components/boards/SharedBoardMenu";
import { SidebarRow, sidebarLabelClass } from "@/components/shell/sidebar-row";

/**
 * A board someone else shared with me. Extracted from `BoardsNav` so the same
 * row renders in two places: inside a folder, and under "Shared with me".
 * Folder membership must never hide WHOSE board it is, so the viewer-eye and
 * the "Shared by" tooltip travel with the row.
 *
 * The row is a `<div>` (`SidebarRow`), not a `<Link>`: a dropdown trigger
 * cannot be nested inside an anchor. Same shape as `PlainBoardRow` — the
 * wrapper carries the hover/active chrome, the `<Link>` is the truncating flex
 * child, and the markers plus the menu ride in `trailing`.
 *
 * `lead` is the 24px slot `PlainBoardRow` reserves for its grip: the inert
 * spacer by default (which `SidebarRow` supplies when `lead` is omitted), a
 * real drag handle when the lazy drag tree passes one. It is NOT optional —
 * every list this row appears in also contains owned rows, which always reserve
 * that 24px, so a shared row without it sits 24px to the left of its
 * neighbours. Inside a folder that was the visible symptom: the folder body's
 * `pl-3` put a filed owned row's link at 36px and a filed shared row's at 24px,
 * 12px apart in the feature's flagship view.
 *
 * For the same reason the row carries no `gap-*` (the primitive forbids it) and
 * spaces its trailing markers with explicit margins: a gap would also push the
 * <Link> off the grip column by the gap width, which is a second, smaller
 * version of the same misalignment.
 *
 * The drag props are deliberately structural — a ref callback, a style and a
 * boolean — so this component stays free of @dnd-kit, exactly like
 * `BoardFolderRow`.
 */
export function SharedBoardRow({
  board,
  isActive,
  folders = [],
  currentFolderId = null,
  lead,
  dragRef,
  isDragging = false,
  style,
}: {
  board: SharedBoardEntry;
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
      // A filed shared row lives inside the region that arms the drag layer, so
      // it needs the same focus anchor an owned row has — see `armDnd`.
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
          {board.access_level === "viewer" ? (
            <Eye
              aria-label="View only"
              className="text-muted-foreground mr-0.5 size-3 shrink-0"
            />
          ) : null}
          {board.owner_name ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="mr-0.5 flex shrink-0 items-center">
                  <Users2
                    aria-label={`Shared by ${board.owner_name}`}
                    className="text-muted-foreground size-3.5"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                Shared by {board.owner_name}
              </TooltipContent>
            </Tooltip>
          ) : null}
          <SharedBoardMenu
            board={{ id: board.id, name: board.name }}
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
