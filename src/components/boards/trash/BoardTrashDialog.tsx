"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";

import {
  loadBoardTrash,
  purgeGroup,
  purgeItem,
  restoreGroup,
  restoreItem,
} from "@/lib/boards/actions";
import { timeAgo } from "@/lib/boards/automation-runs";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type { Tables } from "@/types/database.types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

type TrashGroup = Tables<"groups">;
type TrashItem = Tables<"items">;

/** What "Delete permanently" is about to purge — drives the confirm AlertDialog. */
type PurgeTarget =
  | { kind: "group"; id: string; name: string }
  | { kind: "item"; id: string; name: string };

function byArchivedDesc(
  a: { archived_at: string | null },
  b: {
    archived_at: string | null;
  },
): number {
  return (b.archived_at ?? "").localeCompare(a.archived_at ?? "");
}

/**
 * Per-board Trash. A shadcn `Dialog` opened on demand from the board header —
 * off the board hot path, so no RSC navigation: on open it makes ONE bounded
 * read (`loadBoardTrash`, the `"use server"` wrapper over the RLS-scoped
 * `getBoardTrash`) into local state. Rows are archived groups + top-level items,
 * each restorable or permanently purgeable (AlertDialog confirm), plus an
 * "Empty trash" that purges everything listed. Restore/purge optimistically drop
 * the row from the list and roll back with an error toast on failure — the board
 * cache resyncs via realtime (restore flips `archived_at` to null, folded as an
 * insert on every open board), so this dialog only owns its own list.
 */
export function BoardTrashDialog({
  boardId,
  open,
  onOpenChange,
}: {
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [groups, setGroups] = useState<TrashGroup[]>([]);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The reads/state updates live in an async function (not the effect body)
    // so they run as a task, not a synchronous cascade on mount/open.
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const res = await loadBoardTrash(boardId);
        if (cancelled) return;
        setGroups(res.groups);
        setItems(res.items);
      } catch (err: unknown) {
        if (cancelled) return;
        setLoadError(true);
        showMutationError(
          "Couldn't load Trash.",
          err instanceof Error ? err : new Error(String(err)),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function doRestoreGroup(group: TrashGroup) {
    setBusy(true);
    setGroups((prev) => prev.filter((g) => g.id !== group.id));
    const res = await restoreGroup({ groupId: group.id });
    if (!res.ok) {
      setGroups((prev) => [...prev, group].sort(byArchivedDesc));
      showMutationError("Couldn't restore the group.", new Error(res.error));
    }
    setBusy(false);
  }

  async function doRestoreItem(item: TrashItem) {
    setBusy(true);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    const res = await restoreItem({ itemId: item.id });
    if (!res.ok) {
      setItems((prev) => [...prev, item].sort(byArchivedDesc));
      showMutationError("Couldn't restore the item.", new Error(res.error));
    }
    setBusy(false);
  }

  async function confirmPurge() {
    if (!purgeTarget) return;
    const target = purgeTarget;
    setPurgeTarget(null);
    setBusy(true);
    if (target.kind === "group") {
      const removed = groups.find((g) => g.id === target.id);
      setGroups((prev) => prev.filter((g) => g.id !== target.id));
      const res = await purgeGroup({ groupId: target.id });
      if (!res.ok && removed) {
        setGroups((prev) => [...prev, removed].sort(byArchivedDesc));
        showMutationError("Couldn't delete the group.", new Error(res.error));
      }
    } else {
      const removed = items.find((i) => i.id === target.id);
      setItems((prev) => prev.filter((i) => i.id !== target.id));
      const res = await purgeItem({ itemId: target.id });
      if (!res.ok && removed) {
        setItems((prev) => [...prev, removed].sort(byArchivedDesc));
        showMutationError("Couldn't delete the item.", new Error(res.error));
      }
    }
    setBusy(false);
  }

  async function confirmEmpty() {
    setEmptyOpen(false);
    setBusy(true);
    const snapshotGroups = groups;
    const snapshotItems = items;
    setGroups([]);
    setItems([]);
    const results = await Promise.all([
      ...snapshotGroups.map((g) => purgeGroup({ groupId: g.id })),
      ...snapshotItems.map((i) => purgeItem({ itemId: i.id })),
    ]);
    const firstError = results.find((r) => !r.ok);
    if (firstError && !firstError.ok) {
      // Best-effort: some rows may have purged. Re-read to reflect the true
      // remaining Trash rather than guessing which survived.
      showMutationError(
        "Couldn't empty the Trash completely.",
        new Error(firstError.error),
      );
      try {
        const res = await loadBoardTrash(boardId);
        setGroups(res.groups);
        setItems(res.items);
      } catch {
        // The toast already reported the failure; leave the list cleared.
      }
    }
    setBusy(false);
  }

  const isEmpty =
    !loading && !loadError && groups.length === 0 && items.length === 0;
  const hasRows = groups.length > 0 || items.length > 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Trash</DialogTitle>
            <DialogDescription>
              Archived groups and items on this board. Restore them, or delete
              them permanently — permanent deletion cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[min(60vh,28rem)] overflow-y-auto">
            {loading ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading Trash…
              </div>
            ) : loadError ? (
              <p
                role="alert"
                className="text-destructive py-10 text-center text-sm"
              >
                Couldn&rsquo;t load Trash. Close and try again.
              </p>
            ) : isEmpty ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
                <Trash2 className="size-5" />
                Trash is empty.
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {groups.map((group) => (
                  <TrashRow
                    key={`group-${group.id}`}
                    kind="group"
                    name={group.name}
                    archivedAt={group.archived_at}
                    busy={busy}
                    onRestore={() => doRestoreGroup(group)}
                    onPurge={() =>
                      setPurgeTarget({
                        kind: "group",
                        id: group.id,
                        name: group.name,
                      })
                    }
                  />
                ))}
                {items.map((item) => (
                  <TrashRow
                    key={`item-${item.id}`}
                    kind="item"
                    name={item.name}
                    archivedAt={item.archived_at}
                    busy={busy}
                    onRestore={() => doRestoreItem(item)}
                    onPurge={() =>
                      setPurgeTarget({
                        kind: "item",
                        id: item.id,
                        name: item.name,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          {hasRows ? (
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setEmptyOpen(true)}
              >
                <Trash2 className="size-3.5" /> Empty trash
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(o) => {
          if (!o) setPurgeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{purgeTarget?.name}&rdquo; permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the {purgeTarget?.kind}
              {purgeTarget?.kind === "group" ? " and all its items" : ""} and
              frees any attachments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void confirmPurge();
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={emptyOpen} onOpenChange={setEmptyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty the Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every archived group and item on this
              board and frees their attachments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void confirmEmpty();
              }}
            >
              Empty trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TrashRow({
  kind,
  name,
  archivedAt,
  busy,
  onRestore,
  onPurge,
}: {
  kind: "group" | "item";
  name: string;
  archivedAt: string | null;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <li
      className={cn(
        "bg-surface flex items-center gap-3 rounded-md border px-3 py-2",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-muted-foreground text-xs">
          {kind === "group" ? "Group" : "Item"}
          {archivedAt ? ` · archived ${timeAgo(archivedAt)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`Restore ${kind} ${name}`}
          onClick={onRestore}
        >
          <RotateCcw className="size-3.5" /> Restore
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          className="text-destructive hover:text-destructive"
          aria-label={`Delete ${kind} ${name} permanently`}
          onClick={onPurge}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}
