"use client";

import Link from "next/link";
import { Eye, Users2 } from "lucide-react";
import type { SharedBoardEntry } from "@/lib/boards/queries";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A board someone else shared with me. Extracted from `BoardsNav` so the same
 * row renders in two places: inside a folder, and under "Shared with me".
 * Folder membership must never hide WHOSE board it is, so the viewer-eye and
 * the "Shared by" tooltip travel with the row.
 */
export function SharedBoardRow({
  board,
  isActive,
}: {
  board: SharedBoardEntry;
  isActive: boolean;
}) {
  return (
    <Link
      href={`/boards/${board.id}`}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group/row flex items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors",
        isActive
          ? "bg-primary/80 text-foreground"
          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{board.name}</span>
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
    </Link>
  );
}
