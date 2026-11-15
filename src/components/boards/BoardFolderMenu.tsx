"use client";

import { useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { deleteFolder, renameFolder } from "@/lib/folders/actions";
import { FOLDER_GONE_ERROR } from "@/lib/folders/types";
import { useNavIsGuest } from "@/components/boards/nav-guest";
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

// Loaded on first open, like the folder header's copy of it.
const ShareFolderDialog = dynamic(
  () =>
    import("@/components/folders/ShareFolderDialog").then(
      (m) => m.ShareFolderDialog,
    ),
  { ssr: false },
);

export function BoardFolderMenu({
  folder,
}: {
  folder: { id: string; name: string };
}) {
  const router = useRouter();
  // A guest keeps "Share folder…" (it opens read-only for them) but cannot
  // rename or delete a folder, so those are not offered (see nav-guest).
  const isGuest = useNavIsGuest();
  const [isPending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Mounted on first open and kept, so the close animation and focus return run.
  const [shareMounted, setShareMounted] = useState(false);
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState<string | null>(null);

  function submitRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) {
      setRenameOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await renameFolder({ folderId: folder.id, name: trimmed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // renameFolder's updateTag(foldersTag) already re-rendered the route in
      // the action response — no client refresh.
      setRenameOpen(false);
    });
  }

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteFolder({ folderId: folder.id });
      // "Already gone" is not a failure to report on a DELETE — it is the
      // outcome the user asked for, reached by another tab. Reporting it left
      // the dialog open with Cancel as the only exit and the ghost folder still
      // in the sidebar. Treat it as success: close, and refresh so the stale row
      // goes too.
      if (!res.ok && res.error !== FOLDER_GONE_ERROR) {
        setError(res.error);
        return;
      }
      setDeleteOpen(false);
      // A real delete expires the folders tag, so the action response already
      // carries the re-rendered sidebar. The "already gone" arm returns BEFORE
      // any updateTag — there the client refresh is the only thing that drops
      // the ghost row, so it stays, for that arm alone.
      if (!res.ok) router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={menuTrigger}
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Folder actions for ${folder.name}`}
            className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover/folder:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={() => {
              setShareMounted(true);
              setShareOpen(true);
            }}
          >
            Share folder…
          </DropdownMenuItem>
          {isGuest ? null : (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  setName(folder.name);
                  setError(null);
                  setRenameOpen(true);
                }}
              >
                Rename
              </DropdownMenuItem>
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
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>Give this folder a new name.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rename-folder-${folder.id}`}>Folder name</Label>
              <Input
                id={`rename-folder-${folder.id}`}
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
              Delete the folder &ldquo;{folder.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The boards inside it aren&rsquo;t deleted — they move back to your
              main list.
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
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {shareMounted && (
        <ShareFolderDialog
          folderId={folder.id}
          folderName={folder.name}
          open={shareOpen}
          onOpenChange={setShareOpen}
          returnFocusRef={menuTrigger}
        />
      )}
    </>
  );
}
