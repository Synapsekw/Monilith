"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";

import { createFolder } from "@/lib/folders/actions";
import { showMutationSuccess } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * "New folder" — creates a shared folder in the active workspace. A folder is a
 * project: it is visible to the whole workspace and gets its own command center
 * at `/folders/<id>`.
 *
 * `workspaceId` is optional only because the sidebar renders before the active
 * workspace resolves; without one there is nothing to create the folder IN, so
 * the trigger is disabled rather than the submit failing at the action.
 */
export function NewFolderDialog({ workspaceId }: { workspaceId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || !workspaceId) return;
    setError(null);
    startTransition(async () => {
      const res = await createFolder({ workspaceId, name: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setOpen(false);
      // An empty folder now DOES render in the nav, so the refresh below is
      // itself visible confirmation. The toast points at the next step: the
      // folder's command center is where it gets built out.
      showMutationSuccess(
        `Folder “${trimmed}” created`,
        "Open it from the sidebar to build its command center.",
      );
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="New folder"
          disabled={!workspaceId}
          className="text-muted-foreground hover:text-foreground"
        >
          <FolderPlus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            A folder is a project everyone in this workspace can see. It gets
            its own command center — add boards to it from a board’s ⋯ menu.
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
            <Label htmlFor="new-folder-name">Folder name</Label>
            <Input
              id="new-folder-name"
              aria-label="Folder name"
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
              {isPending ? "Creating…" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
