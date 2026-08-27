"use client";

import { MoreHorizontal } from "lucide-react";

import type { BoardFolder } from "@/lib/boards/folders/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoveToFolderMenu } from "@/components/boards/MoveToFolderMenu";

/**
 * Row menu for a board somebody else shared with me. A shared board is not
 * mine, so this carries the move entries ONLY — no rename, duplicate or
 * delete. The trigger's label names the board because several of these rows
 * can sit side by side in one folder.
 */
export function SharedBoardMenu({
  board,
  folders,
  currentFolderId,
}: {
  board: { id: string; name: string };
  folders: BoardFolder[];
  currentFolderId: string | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Board actions for ${board.name}`}
          className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <MoveToFolderMenu
          boardId={board.id}
          folders={folders}
          currentFolderId={currentFolderId}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
