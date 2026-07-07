"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import {
  archiveBoard,
  duplicateBoard,
  renameBoard,
  restoreBoard,
} from "@/lib/boards/actions";
import { showMutationError, showUndoToast } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function BoardItemMenu({
  board,
  isActive,
}: {
  board: { id: string; name: string };
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(board.name);
  const [error, setError] = useState<string | null>(null);

  function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === board.name) {
      setRenameOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await renameBoard({ boardId: board.id, name: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRenameOpen(false);
      router.refresh();
    });
  }

  function doDuplicate() {
    startTransition(async () => {
      const res = await duplicateBoard({ boardId: board.id });
      if (!res.ok) {
        // The dropdown has already closed, so there's no inline surface to host
        // the message — toast it (delete keeps its AlertDialog open and shows
        // the error inline instead).
        showMutationError(
          "Couldn't duplicate the board.",
          new Error(res.error),
        );
        return;
      }
      router.refresh();
    });
  }

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const res = await archiveBoard({ boardId: board.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDeleteOpen(false);
      // Reversible: offer an immediate Undo that restores the board, then bring
      // it back into view. Trash is the durable recovery path once this expires.
      showUndoToast("Board moved to Trash", () => {
        startTransition(async () => {
          const undo = await restoreBoard({ boardId: board.id });
          if (!undo.ok) {
            showMutationError(
              "Couldn't restore the board.",
              new Error(undo.error),
            );
            return;
          }
          router.refresh();
        });
      });
      if (isActive) router.push("/boards");
      else router.refresh();
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
            aria-label="Board actions"
            className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={() => {
              setName(board.name);
              setError(null);
              setRenameOpen(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={doDuplicate}>Duplicate</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              setError(null);
              setDeleteOpen(true);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
            <DialogDescription>Give this board a new name.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rename-board-${board.id}`}>Board name</Label>
              <Input
                id={`rename-board-${board.id}`}
                aria-label="Board name"
                autoFocus
                value={name}
                disabled={isPending}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={isPending || !name.trim()}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move &ldquo;{board.name}&rdquo; to Trash?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The board and all its items move to Trash. You can restore it from
              Trash.
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
                doDelete();
              }}
              disabled={isPending}
            >
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
