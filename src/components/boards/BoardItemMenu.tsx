"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { deleteBoard, duplicateBoard, renameBoard } from "@/lib/boards/actions";
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
      if (res.ok) router.refresh();
    });
  }

  function doDelete() {
    startTransition(async () => {
      const res = await deleteBoard({ boardId: board.id });
      if (!res.ok) return;
      setDeleteOpen(false);
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
            onSelect={() => setDeleteOpen(true)}
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
              Delete &ldquo;{board.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the board and all its items. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
              Delete board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
