"use client";

import { useMutation } from "@tanstack/react-query";
import {
  addSubitem,
  archiveItem,
  createItem,
  moveItem,
  renameItem,
  reorderItem,
  restoreItem,
} from "@/lib/boards/actions";
import {
  insertItem,
  removeItem,
  replaceItemId,
  type BoardCache,
  type CacheItem,
} from "@/lib/boards/cache";
import { isOptimisticId, newOptimisticId } from "@/lib/boards/optimistic-id";
import { showMutationError, showUndoToast } from "@/lib/ui/mutation-toast";
import type {
  AddItemVars,
  BoardMutationCtx,
  Ctx,
  RenameItemVars,
} from "./shared";
import { assertOnline } from "@/lib/offline/online-status";

/** Context carried from an optimistic add's `onMutate` to its settle handlers. */
type AddCtx = { tempId: string };

/**
 * Append position for a new row: one past the highest position among the rows
 * it will sit with (a group's top-level rows, or a parent's subitems). Mirrors
 * the server's own append semantics closely enough for the ~one round-trip the
 * temp row is on screen; the server row's real position lands on reconcile.
 */
function nextPosition(
  items: readonly CacheItem[],
  sibling: (i: CacheItem) => boolean,
): number {
  return (
    items.reduce((m, i) => (sibling(i) ? Math.max(m, i.position) : m), 0) + 1
  );
}

/**
 * Build the temp row an optimistic add paints immediately. Its id is a
 * client-minted `optimistic-*` (see @/lib/boards/optimistic-id) — while it is
 * on screen the row is READ-ONLY: no cell edit, rename, panel-open or bulk
 * select, because every one of those writes is keyed by item id and the id is
 * about to be replaced. The components enforcing that rule cite the same note.
 */
function tempItem(
  cache: BoardCache,
  tempId: string,
  fields: Pick<CacheItem, "group_id" | "parent_id" | "name" | "position">,
): CacheItem {
  const now = new Date().toISOString();
  return {
    id: tempId,
    org_id: cache.board.org_id,
    board_id: cache.board.id,
    archived_at: null,
    archived_by: null,
    // The mutation layer has no session, and `created_by` is stamped from
    // auth.uid() server-side. For the one round-trip the row is temporary the
    // Created-by cell renders its unknown-member dash; the reconciled server
    // row carries the real author.
    created_by: "",
    created_at: now,
    updated_at: now,
    ...fields,
  };
}

/** Item mutations: add/subitem/archive/restore/reorder/move/rename. */
export function useItemMutations(ctx: BoardMutationCtx) {
  const {
    qc,
    key,
    rollback,
    resyncOnError,
    optimisticItemField,
    optimisticMoveItem,
  } = ctx;

  /**
   * Add a new item. OPTIMISTIC: `onMutate` paints a temp row (appended to the
   * group) so the input can be cleared and re-typed at once instead of
   * serialising on network latency; `onSuccess` swaps the temp id for the
   * server row IN PLACE (no jump in the group), and `onError` removes it — the
   * caller (AddItemRow) surfaces the failure inline and restores what was
   * typed, so no toast fires here (no double feedback).
   *
   * Realtime echo: the `items` INSERT may arrive before the action resolves.
   * `applyItem` in realtime-buffer reconciles such an echo onto the matching
   * temp row, and `replaceItemId` is idempotent if the real row is already
   * there — either way exactly one row survives.
   */
  const addItemMutation = useMutation<
    { item: CacheItem },
    Error,
    AddItemVars,
    AddCtx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await createItem(vars);
      if (!res.ok) throw new Error(res.error);
      return { item: res.data.item as CacheItem };
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const tempId = newOptimisticId();
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        qc.setQueryData<BoardCache>(
          key,
          insertItem(
            previous,
            tempItem(previous, tempId, {
              group_id: vars.groupId,
              parent_id: null,
              name: vars.name,
              position: nextPosition(
                previous.items,
                (i) => i.group_id === vars.groupId && i.parent_id === null,
              ),
            }),
          ),
        );
      }
      return { tempId };
    },
    onSuccess: ({ item }, _vars, ctx) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? replaceItemId(prev, ctx.tempId, item) : prev,
      );
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? removeItem(prev, ctx.tempId) : prev,
      );
    },
  });

  /** Add a subitem. Optimistic, mirroring addItem: the temp row is parented to
   *  `parentId` and inherits the parent's (denormalized) group_id. A parent that
   *  is itself still optimistic is skipped — its id would not resolve
   *  server-side — leaving the row to appear on the server response. */
  const addSubitemMutation = useMutation<
    { item: CacheItem },
    Error,
    { parentId: string; name: string },
    AddCtx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await addSubitem(vars);
      if (!res.ok) throw new Error(res.error);
      return { item: res.data.item as CacheItem };
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const tempId = newOptimisticId();
      const previous = qc.getQueryData<BoardCache>(key);
      const parent = previous?.items.find((i) => i.id === vars.parentId);
      if (previous && parent && !isOptimisticId(parent.id)) {
        qc.setQueryData<BoardCache>(
          key,
          insertItem(
            previous,
            tempItem(previous, tempId, {
              group_id: parent.group_id,
              parent_id: parent.id,
              name: vars.name,
              position: nextPosition(
                previous.items,
                (i) => i.parent_id === parent.id,
              ),
            }),
          ),
        );
      }
      return { tempId };
    },
    onSuccess: ({ item }, _vars, ctx) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? replaceItemId(prev, ctx.tempId, item) : prev,
      );
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? removeItem(prev, ctx.tempId) : prev,
      );
    },
  });

  /**
   * Restore an archived item (+ its same-batch subitems). Non-optimistic: the
   * archived subtree isn't in the cache, so on success we resync the board to
   * rehydrate it (mirrors the cascade resync path). Undo handler for archiveItem.
   */
  const restoreItemMutation = useMutation<unknown, Error, { itemId: string }>({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await restoreItem(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: () => resyncOnError(),
    onError: (err) => {
      showMutationError("Couldn't restore the item.", err);
    },
  });

  /**
   * Archive an item/subitem (soft-delete → Trash). Optimistic remove (cascades
   * subitems in cache); resync on failure. On success fire an Undo toast whose
   * action restores the item via restoreItemMutation.
   */
  const archiveItemMutation = useMutation<
    unknown,
    Error,
    { itemId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await archiveItem(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    // Cascade archive (item + subitems): resync from the server on failure
    // rather than reconstruct the removed subtree by hand.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(key, removeItem(previous, vars.itemId));
      return {};
    },
    onError: (err) => {
      resyncOnError();
      showMutationError("Couldn't delete the item — it was restored.", err);
    },
    onSuccess: (_d, vars) =>
      showUndoToast("Item moved to Trash", () =>
        restoreItemMutation.mutate(vars),
      ),
  });

  /** Reorder an item (subitem within its parent). Optimistic position patch; rollback on error. */
  const reorderItemMutation = useMutation<
    unknown,
    Error,
    { itemId: string; position: number },
    Ctx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await reorderItem(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticItemField(vars.itemId, { position: vars.position });
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't reorder the item — your change was undone.",
        err,
      );
    },
  });

  /** Move a top-level item to another group (drag-drop across groups). Optimistic; rollback on error. */
  const moveItemToGroupMutation = useMutation<
    unknown,
    Error,
    { itemId: string; groupId: string; position?: number },
    Ctx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await moveItem(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticMoveItem(vars.itemId, vars.groupId, vars.position);
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't move the item — your change was undone.",
        err,
      );
    },
  });

  /**
   * Rename an item. Optimistic: patch the cache immediately with the new name,
   * roll back on error. The Realtime UPDATE echo is idempotent (same id/name).
   */
  const renameItemMutation = useMutation<unknown, Error, RenameItemVars, Ctx>({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await renameItem(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticItemField(vars.itemId, { name: vars.name });
    },
    onError: (err, _vars, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't rename the item — your change was undone.",
        err,
      );
    },
  });

  return {
    addItemMutation,
    addSubitemMutation,
    restoreItemMutation,
    archiveItemMutation,
    reorderItemMutation,
    moveItemToGroupMutation,
    renameItemMutation,
  };
}
