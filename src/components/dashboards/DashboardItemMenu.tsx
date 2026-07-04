"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import {
  deleteDashboard,
  duplicateDashboard,
  renameDashboard,
} from "@/lib/dashboards/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RevealOnHover } from "@/components/ui/reveal-on-hover";
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

export function DashboardItemMenu({
  dashboard,
  isActive,
}: {
  dashboard: { id: string; name: string };
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(dashboard.name);
  const [error, setError] = useState<string | null>(null);

  function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === dashboard.name) {
      setRenameOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await renameDashboard({
        dashboardId: dashboard.id,
        name: trimmed,
      });
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
      const res = await duplicateDashboard({ dashboardId: dashboard.id });
      if (!res.ok) {
        // The dropdown has already closed, so there's no inline surface to host
        // the message — toast it (delete keeps its AlertDialog open and shows
        // the error inline instead).
        showMutationError(
          "Couldn't duplicate the dashboard.",
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
      const res = await deleteDashboard({ dashboardId: dashboard.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDeleteOpen(false);
      if (isActive) router.push("/dashboards");
      else router.refresh();
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
              size="icon-xs"
              aria-label="Dashboard actions"
              className="text-muted-foreground hover:text-foreground pointer-coarse:size-11"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </RevealOnHover>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={() => {
              setName(dashboard.name);
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
            <DialogTitle>Rename dashboard</DialogTitle>
            <DialogDescription>
              Give this dashboard a new name.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rename-dashboard-${dashboard.id}`}>
                Dashboard name
              </Label>
              <Input
                id={`rename-dashboard-${dashboard.id}`}
                aria-label="Dashboard name"
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
            <AlertDialogTitle>Delete “{dashboard.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the dashboard and all its widgets. This
              cannot be undone.
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
              Delete dashboard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
