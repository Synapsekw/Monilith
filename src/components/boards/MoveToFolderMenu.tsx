"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderInput } from "lucide-react";

import { moveBoardToFolder } from "@/lib/boards/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type { BoardFolder } from "@/lib/boards/folders/types";
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
 */
export function MoveToFolderMenu({
  boardId,
  folders,
  currentFolderId,
}: {
  boardId: string;
  folders: BoardFolder[];
  currentFolderId: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function move(folderId: string | null) {
    startTransition(async () => {
      const res = await moveBoardToFolder({ boardId, folderId });
      if (!res.ok) {
        // The dropdown has already closed, so there is no inline surface left.
        showMutationError("Couldn't move the board.", new Error(res.error));
        return;
      }
      // This one DOES change server data (unlike a folder collapse), so a
      // targeted refresh is correct here — not the gotcha-09 case.
      router.refresh();
    });
  }

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
              onSelect={() => move(f.id)}
            >
              <span className="truncate">{f.name}</span>
            </DropdownMenuItem>
          ))
        )}
        {currentFolderId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => move(null)}>
              Remove from folder
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
