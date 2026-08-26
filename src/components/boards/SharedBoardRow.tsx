"use client";

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

/**
 * A board someone else shared with me. Extracted from `BoardsNav` so the same
 * row renders in two places: inside a folder, and under "Shared with me".
 * Folder membership must never hide WHOSE board it is, so the viewer-eye and
 * the "Shared by" tooltip travel with the row.
 *
 * The row is a `<div>`, not a `<Link>`: a dropdown trigger cannot be nested
 * inside an anchor. Same shape as `PlainBoardRow` — the wrapper carries the
 * hover/active chrome, the `<Link>` is the truncating flex child, and the
 * markers plus the menu are siblings of it.
 */
export function SharedBoardRow({
  board,
  isActive,
  folders = [],
  currentFolderId = null,
}: {
  board: SharedBoardEntry;
  isActive: boolean;
  folders?: BoardFolder[];
  currentFolderId?: string | null;
}) {
  return (
    <div
      // A filed shared row lives inside the region that arms the drag layer, so
      // it needs the same focus anchor an owned row has — see `armDnd`.
      data-board-row={board.id}
      className={cn(
        "group/row flex items-center gap-1 rounded-md pr-1 pl-3 transition-colors",
        isActive
          ? "bg-primary/80 text-foreground"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      <Link
        href={`/boards/${board.id}`}
        aria-current={isActive ? "page" : undefined}
        className="min-w-0 flex-1 truncate py-1 text-xs"
      >
        {board.name}
      </Link>
      {board.access_level === "viewer" ? (
        <Eye
          aria-label="View only"
          className="text-muted-foreground size-3 shrink-0"
        />
      ) : null}
      {board.owner_name ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex shrink-0 items-center">
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
    </div>
  );
}
