"use client";

import { FolderInput } from "lucide-react";

import { useMoveBoardToFolder } from "@/components/boards/move-to-folder";
import { useNavIsGuest } from "@/components/boards/nav-guest";
import type { FolderSummary } from "@/lib/folders/types";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The "Move to folder ▸" submenu, shared by the owned-board and shared-board
 * row menus. This is the keyboard path for filing a board — drag is an
 * enhancement on top, never the only way in.
 *
 * The move itself, its error toast and the "this folder is shared" question
 * belong to `MoveBoardToFolderHost` in `BoardsNav`: this submenu lives inside
 * another menu's content and is gone the moment an item is picked.
 *
 * A guest cannot file boards, so for them the submenu is not rendered.
 */
export function MoveToFolderMenu({
  boardId,
  folders,
  currentFolderId,
}: {
  boardId: string;
  folders: FolderSummary[];
  currentFolderId: string | null;
}) {
  const move = useMoveBoardToFolder();
  const isGuest = useNavIsGuest();
  if (isGuest) return null;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderInput className="size-4" />
        Move to folder
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-44">
        {folders.length === 0 ? (
          <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
        ) : (
          folders.map((f) => (
            <DropdownMenuItem
              key={f.id}
              disabled={f.id === currentFolderId}
              onSelect={() =>
                move({ boardId, folderId: f.id, folderName: f.name })
              }
            >
              <span className="truncate">{f.name}</span>
            </DropdownMenuItem>
          ))
        )}
        {currentFolderId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => move({ boardId, folderId: null })}
            >
              Remove from folder
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
