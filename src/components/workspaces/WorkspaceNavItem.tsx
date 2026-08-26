"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";
import { renameWorkspace, deleteWorkspace } from "@/lib/workspaces/actions";

export function WorkspaceNavItem({
  workspace,
  isOrgAdmin,
  isLast,
}: {
  workspace: { id: string; name: string };
  isOrgAdmin: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The message renders inside the delete dialog, where the confirm-name input
  // is the field the user is being asked to act on — so it owns the error.
  const confirmStatus = useFieldStatus(error);
  // A failed delete leaves the dialog open with the button re-enabled; that is
  // the case this reclaims focus for. (Success unmounts it, and the hook then
  // never runs.)
  const deleteRef = useRestoreFocusAfterPending<HTMLButtonElement>(pending);

  function commitRename() {
    const trimmed = name.trim();
    setEditing(false);
    if (!trimmed || trimmed === workspace.name) {
      setName(workspace.name);
      return;
    }
    startTransition(async () => {
      const res = await renameWorkspace({
        workspaceId: workspace.id,
        name: trimmed,
      });
      if (!res.ok) {
        setError(res.error);
        setName(workspace.name);
      }
    });
  }

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteWorkspace({ workspaceId: workspace.id });
      if (res.ok) setDelOpen(false);
      else setError(res.error);
    });
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitRename();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setName(workspace.name);
            setEditing(false);
          }
        }}
        aria-label="Workspace name"
        className="h-8 px-3 text-sm"
      />
    );
  }

  return (
    <div className="group/ws hover:bg-state-hover flex items-center gap-1 rounded-md px-3 py-1.5">
      <span className="text-muted-foreground truncate text-sm">
        {workspace.name}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`${workspace.name} workspace menu`}
            className="text-muted-foreground hover:text-foreground ml-auto opacity-0 transition-opacity group-hover/ws:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setName(workspace.name);
              setEditing(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          {isOrgAdmin ? (
            <DropdownMenuItem
              className="text-destructive"
              disabled={isLast}
              onSelect={() => {
                setError(null);
                setConfirmName("");
                setDelOpen(true);
              }}
            >
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{workspace.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently deletes the workspace and ALL boards and
              dashboards inside it. This can&apos;t be undone. Type the name to
              confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={workspace.name}
            aria-label="Type the workspace name to confirm deletion"
            {...confirmStatus.controlProps}
          />
          <FieldStatus field={confirmStatus} />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDelOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              ref={deleteRef}
              variant="destructive"
              disabled={pending || confirmName !== workspace.name}
              onClick={confirmDelete}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
