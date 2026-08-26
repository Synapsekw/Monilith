"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";

import { createFolder } from "@/lib/boards/folders/actions";
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

/** "New folder" — creates a private folder in the signed-in user's Boards nav. */
export function NewFolderDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await createFolder({ name: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setOpen(false);
      // A brand-new folder is EMPTY, and an empty folder is deliberately not
      // rendered in the nav (design decision 3), so a refresh alone leaves the
      // sidebar byte-identical — the user has no way to tell the create
      // worked. The toast is the only confirmation, so it also has to carry
      // the discovery path: the folder is reachable from a board's ⋯ menu
      // until something is filed into it.
      showMutationSuccess(
        `Folder “${trimmed}” created`,
        "Move a board into it from the board’s ⋯ menu.",
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
          className="text-muted-foreground hover:text-foreground"
        >
          <FolderPlus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Folders are private to you. Drop in your own boards and ones shared
            with you.
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
