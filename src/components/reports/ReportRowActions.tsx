"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { deleteReport } from "@/lib/reports/actions";
import { Button } from "@/components/ui/button";
import { RevealOnHover } from "@/components/ui/reveal-on-hover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

/**
 * Overflow menu for a single report row: a ghost icon trigger that reveals on
 * row hover, with a destructive Delete item guarded by an AlertDialog. On a
 * successful `deleteReport`, `router.refresh()` re-runs the RSC list so the row
 * disappears; failures surface inline in the dialog (which stays open).
 */
export function ReportRowActions({
  reportId,
  boardId,
  reportName,
}: {
  reportId: string;
  boardId: string;
  reportName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteReport({ reportId, boardId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <RevealOnHover className="shrink-0 [&:has([data-state=open])]:opacity-100">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${reportName}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </RevealOnHover>
        <DropdownMenuContent align="end" className="w-40">
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{reportName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete this report? This can&apos;t be undone.
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
              {isPending ? "Deleting…" : "Delete report"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
