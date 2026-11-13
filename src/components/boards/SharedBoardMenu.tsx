"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { leaveBoard } from "@/lib/boards/actions";
import { showMutationSuccess } from "@/lib/ui/mutation-toast";
import type { FolderSummary } from "@/lib/folders/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { MoveToFolderMenu } from "@/components/boards/MoveToFolderMenu";

/**
 * Row menu for a board somebody else shared with me. A shared board is not
 * mine, so there is no rename, duplicate or delete — only the move entries and
 * **Leave board**, which drops MY access (my `board_members` grant) and takes
 * it out of my sidebar. The board and everyone else's access are untouched; the
 * owner can invite me again. The trigger's label names the board because
 * several of these rows can sit side by side in one folder.
 */
export function SharedBoardMenu({
  board,
  folders,
  currentFolderId,
  isActive = false,
}: {
  board: { id: string; name: string };
  folders: FolderSummary[];
  currentFolderId: string | null;
  /** The board is the one open on screen — leaving it navigates away. */
  isActive?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function doLeave() {
    setError(null);
    startTransition(async () => {
      const res = await leaveBoard({ boardId: board.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLeaveOpen(false);
      showMutationSuccess(`You left “${board.name}”`);
      // leaveBoard expires this user's shared-boards tag, so the sidebar
      // re-renders in the action response — only navigation is left to do.
      if (isActive) router.push("/boards");
    });
  }

  return (
    <>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              setError(null);
              setLeaveOpen(true);
            }}
          >
            Leave board
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Leave &ldquo;{board.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It will disappear from your sidebar and you will lose access. The
              board stays as it is for everyone else, and the owner can invite
              you again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                doLeave();
              }}
              disabled={isPending}
            >
              Leave board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
