"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDashboard } from "@/lib/dashboards/actions";
import { attachDashboardToFolder } from "@/lib/folders/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";

/**
 * "New dashboard" — the create dialog lifted out of the deleted `DashboardsNav`
 * so it can be opened from wherever a dashboard is actually created now: a
 * folder's Overview strip (with `folderId`), or any other surface that owns its
 * own trigger.
 *
 * Fully CONTROLLED (`open` / `onOpenChange`) and triggerless on purpose — the
 * caller owns the affordance, and a triggerless controlled dialog is also what
 * lets a command-palette flag open it.
 */
export function NewDashboardDialog({
  workspaceId,
  folderId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  folderId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const nameStatus = useFieldStatus(error);
  // Only a failed create keeps the dialog mounted; that is when the submit
  // button has to reclaim the focus its own `disabled` dropped to <body>.
  const submitRef = useRestoreFocusAfterPending<HTMLButtonElement>(isPending);

  function submit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createDashboard({ workspaceId, name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Filing it is a SEPARATE, non-fatal step: the dashboard exists either
      // way, and the user is about to land on it, so a failed attach must not
      // strand them in the dialog. It is recoverable from the folder's picker.
      if (folderId) {
        await attachDashboardToFolder({
          dashboardId: res.data.dashboard.id,
          folderId,
        });
      }
      setName("");
      onOpenChange(false);
      router.push(`/dashboards/${res.data.dashboard.id}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New dashboard</DialogTitle>
          <DialogDescription>
            Give your dashboard a name to get started.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dashboard-name">Dashboard name</Label>
            <Input
              id="dashboard-name"
              {...nameStatus.controlProps}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Team overview"
            />
          </div>
          <FieldStatus field={nameStatus} />
          <DialogFooter>
            <Button
              ref={submitRef}
              type="submit"
              disabled={isPending || !name.trim()}
            >
              {isPending ? "Creating…" : "Create dashboard"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
