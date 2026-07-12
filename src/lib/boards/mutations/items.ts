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
  type BoardCache,
  type CacheItem,
} from "@/lib/boards/cache";
import { showMutationError, showUndoToast } from "@/lib/ui/mutation-toast";
import type {
  AddItemVars,
  BoardMutationCtx,
  Ctx,
  RenameItemVars,
} from "./shared";

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
   * Add a new item. Patch-on-success: we wait for the server to return the
   * real item row (with server-assigned id/position), then insert it into the
   * cache. The Realtime INSERT echo is idempotent via `insertItem`.
   */
  const addItemMutation = useMutation<
    { item: CacheItem },
    Error,
    AddItemVars,
    void
  >({
    mutationFn: async (vars) => {
      const res = await createItem(vars);
      if (!res.ok) throw new Error(res.error);
      return { item: res.data.item as CacheItem };
    },
    onSuccess: ({ item }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? insertItem(prev, item) : prev,
      );
    },
  });

  /** Add a subitem. Patch-on-success (mirrors addItem); Realtime echo idempotent. */
  const addSubitemMutation = useMutation<
    { item: CacheItem },
    Error,
    { parentId: string; name: string },
    void
  >({
    mutationFn: async (vars) => {
      const res = await addSubitem(vars);
      if (!res.ok) throw new Error(res.error);
      return { item: res.data.item as CacheItem };
    },
    onSuccess: ({ item }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? insertItem(prev, item) : prev,
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
