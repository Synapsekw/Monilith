"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveX, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";

import { purgeBoard, restoreBoard } from "@/lib/boards/actions";
import { timeAgo } from "@/lib/boards/automation-runs";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

export type ArchivedBoard = {
  id: string;
  name: string;
  workspace_id: string;
  archived_at: string | null;
  archived_by: string | null;
  archived_by_name: string | null;
};

/**
 * Workspace-level Trash: the archived boards the current user owns, restorable
 * or purgeable. Rendered on `/boards` from a Server Component that reads
 * `getArchivedBoards()` and passes the array in — so first paint costs 0 extra
 * client round-trips (working-agreement #5). All entries are owner-owned
 * (`getArchivedBoards` scopes to `created_by = me`), so purge (owner-only) is
 * always permitted; the server action re-checks regardless.
 *
 * Restore/purge are server-data changes → Server Actions. On success the row is
 * dropped optimistically and `router.refresh()` re-runs the RSC so the sidebar
 * board list (busted via `invalidateMyBoards`) reflects the change.
 */
export function ArchivedBoardsSection({ boards }: { boards: ArchivedBoard[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(boards);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Landing on /boards#archived (the sidebar Trash link) opens the list. Handles
  // both a fresh mount and a same-page hash change (Link to the current pathname
  // doesn't remount the RSC), so clicking Trash while already on /boards expands it.
  useEffect(() => {
    const openIfHash = () => {
      if (window.location.hash === "#archived") setOpen(true);
    };
    openIfHash();
    window.addEventListener("hashchange", openIfHash);
    return () => window.removeEventListener("hashchange", openIfHash);
  }, []);

  // The list is empty (nothing archived) → render no affordance at all.
  if (rows.length === 0) return null;

  function doRestore(boardId: string) {
    setPendingId(boardId);
    startTransition(async () => {
      const res = await restoreBoard({ boardId });
      setPendingId(null);
      if (!res.ok) {
        showMutationError("Couldn't restore the board.", new Error(res.error));
        return;
      }
      setRows((prev) => prev.filter((b) => b.id !== boardId));
      router.refresh();
    });
  }

  function doPurge(boardId: string) {
    setPendingId(boardId);
    startTransition(async () => {
      const res = await purgeBoard({ boardId });
      setPendingId(null);
      if (!res.ok) {
        showMutationError(
          "Couldn't delete the board permanently.",
          new Error(res.error),
        );
        return;
      }
      setConfirmId(null);
      setRows((prev) => prev.filter((b) => b.id !== boardId));
      router.refresh();
    });
  }

  const confirmBoard = rows.find((b) => b.id === confirmId) ?? null;

  return (
    <section id="archived" className="bg-surface scroll-mt-4 rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors"
      >
        {open ? (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        )}
        <ArchiveX className="text-muted-foreground size-4 shrink-0" />
        <span className="text-sm font-medium">Archived boards</span>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {rows.length}
        </span>
      </button>

      {open ? (
        <ul className="border-t">
          {rows.map((board, i) => (
            <li
              key={board.id}
              className={cn(
                "flex items-center gap-3 px-3 py-2",
                i > 0 && "border-t",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{board.name}</p>
                {board.archived_at ? (
                  <p className="text-muted-foreground truncate text-xs">
                    {board.archived_by_name
                      ? `archived by ${board.archived_by_name}, ${timeAgo(board.archived_at)}`
                      : `archived ${timeAgo(board.archived_at)}`}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending && pendingId === board.id}
                onClick={() => doRestore(board.id)}
              >
                <RotateCcw className="size-3.5" />
                Restore
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={isPending && pendingId === board.id}
                onClick={() => setConfirmId(board.id)}
              >
                Delete permanently
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <AlertDialog
        open={confirmId !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete
              {confirmBoard ? ` “${confirmBoard.name}”` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the board and all its items and
              attachments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmId) doPurge(confirmId);
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
