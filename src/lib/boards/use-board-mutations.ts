"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  clearCell,
  createItem,
  renameItem,
  upsertCell,
} from "@/lib/boards/actions";
import {
  createDependency,
  deleteDependency,
} from "@/lib/boards/dependency-actions";
import {
  insertItem,
  removeCellValue,
  removeDependency,
  replaceItem,
  upsertCellValue,
  type BoardCache,
  type CacheCellValue,
  type CacheItem,
} from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";

type SetCellVars = { itemId: string; columnId: string; value: unknown };
type ClearCellVars = { itemId: string; columnId: string };
type AddItemVars = { groupId: string; name: string };
type RenameItemVars = { itemId: string; name: string };
type AddDependencyVars = { predecessorId: string; successorId: string };
type RemoveDependencyVars = { dependencyId: string };
type Ctx = { previous?: BoardCache };

export function useBoardMutations(boardId: string) {
  const qc = useQueryClient();
  const key = boardKey(boardId);

  const setCellMutation = useMutation<unknown, Error, SetCellVars, Ctx>({
    mutationFn: async (vars) => {
      const res = await upsertCell(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const cell: CacheCellValue = {
          org_id: previous.board.org_id,
          board_id: previous.board.id,
          item_id: vars.itemId,
          column_id: vars.columnId,
          value: vars.value as CacheCellValue["value"],
          updated_at: new Date().toISOString(),
        };
        qc.setQueryData<BoardCache>(key, upsertCellValue(previous, cell));
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      // No refetch: Realtime + revalidatePath keep the cache fresh.
    },
  });

  const clearCellMutation = useMutation<unknown, Error, ClearCellVars, Ctx>({
    mutationFn: async (vars) => {
      const res = await clearCell(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        qc.setQueryData<BoardCache>(
          key,
          removeCellValue(previous, vars.itemId, vars.columnId),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

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
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const existing = previous.items.find((i) => i.id === vars.itemId);
        if (existing) {
          qc.setQueryData<BoardCache>(
            key,
            replaceItem(previous, { ...existing, name: vars.name }),
          );
        }
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  /**
   * Add a dependency. Non-optimistic: we do NOT insert into the cache here.
   * The Realtime INSERT echo will arrive in ms and `addDependency` is idempotent,
   * so we let realtime own the cache update. This avoids needing to reconstruct
   * the full CacheDependency row client-side (the server assigns id/org_id/etc).
   */
  const addDependencyMutation = useMutation<void, Error, AddDependencyVars>({
    mutationFn: async (vars) => {
      const res = await createDependency(vars);
      if (!res.ok) throw new Error(res.error);
    },
  });

  /**
   * Remove a dependency. Optimistic: remove from cache immediately, roll back
   * on error. Mirror of clearCellMutation.
   */
  const removeDependencyMutation = useMutation<
    unknown,
    Error,
    RemoveDependencyVars,
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await deleteDependency(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        qc.setQueryData<BoardCache>(
          key,
          removeDependency(previous, vars.dependencyId),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  return {
    setCell: (vars: SetCellVars) => setCellMutation.mutate(vars),
    clearCellValue: (vars: ClearCellVars) => clearCellMutation.mutate(vars),
    addItem: (
      vars: AddItemVars,
      callbacks?: {
        onSuccess?: (item: CacheItem) => void;
        onError?: (err: Error) => void;
      },
    ) =>
      addItemMutation.mutate(vars, {
        onSuccess: (data) => callbacks?.onSuccess?.(data.item),
        onError: (err) => callbacks?.onError?.(err),
      }),
    renameItem: (vars: RenameItemVars) => renameItemMutation.mutate(vars),
    addDependency: (
      vars: AddDependencyVars,
      callbacks?: { onError?: (err: Error) => void },
    ) =>
      addDependencyMutation.mutate(vars, {
        onError: (e) => callbacks?.onError?.(e),
      }),
    removeDependency: (vars: RemoveDependencyVars) =>
      removeDependencyMutation.mutate(vars),
  };
}
