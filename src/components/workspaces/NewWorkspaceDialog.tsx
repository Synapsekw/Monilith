"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";
import { createWorkspace } from "@/lib/workspaces/actions";

export function NewWorkspaceDialog({
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
} = {}) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = (next: boolean) => {
    setOpenLocal(next);
    onOpenChange?.(next);
  };
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameStatus = useFieldStatus(error);
  // Failure is the only path that leaves this dialog open, and it re-enables
  // the Create button that dropped focus when it disabled itself.
  const createRef = useRestoreFocusAfterPending<HTMLButtonElement>(pending);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await createWorkspace({ name: trimmed });
      if (res.ok) {
        setName("");
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <DialogTrigger asChild>
          <button
            aria-label="New workspace"
            className="text-muted-foreground hover:text-foreground ml-auto"
          >
            <Plus className="size-4" />
          </button>
        </DialogTrigger>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Create a workspace to organize boards and dashboards.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          placeholder="Workspace name"
          aria-label="Workspace name"
          {...nameStatus.controlProps}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <FieldStatus field={nameStatus} />
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            ref={createRef}
            onClick={submit}
            disabled={pending || !name.trim()}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
