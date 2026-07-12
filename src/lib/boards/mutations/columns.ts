"use client";

import { useMutation } from "@tanstack/react-query";
import {
  createColumn,
  deleteColumn,
  removeColumnOption,
  renameColumn,
  reorderColumn,
  resizeColumn,
  updateColumnSettings,
} from "@/lib/boards/actions";
import {
  insertColumn,
  removeColumn,
  replaceColumn,
  type BoardCache,
  type CacheCellValue,
  type CacheColumn,
} from "@/lib/boards/cache";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type { ColumnKind } from "@/lib/validations/boards";
import { stripOption, type BoardMutationCtx, type Ctx } from "./shared";

/** Column mutations: add/rename/settings/resize/reorder/delete + option removal. */
export function useColumnMutations(ctx: BoardMutationCtx) {
  const { qc, key, boardId, rollback, resyncOnError, optimisticColumn } = ctx;

  const addColumnMutation = useMutation<
    { column: CacheColumn },
    Error,
    { kind: ColumnKind; settings?: Record<string, unknown> },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await createColumn({
        boardId,
        kind: vars.kind,
        settings: vars.settings,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    // Insert the returned column immediately (mirrors addItem). The Realtime
    // INSERT echo is idempotent via `insertColumn`, so this client and peers
    // don't double-add — and the column appears even if Realtime lags or drops.
    onSuccess: ({ column }) => {
      qc.setQueryData<BoardCache>(key, (prev) =>
        prev ? insertColumn(prev, column) : prev,
      );
    },
  });

  const renameColumnMutation = useMutation<
    unknown,
    Error,
    { columnId: string; name: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await renameColumn(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticColumn(vars.columnId, { name: vars.name });
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't rename the column — your change was undone.",
        err,
      );
    },
  });

  const updateColumnSettingsMutation = useMutation<
    unknown,
    Error,
    { columnId: string; settings: Record<string, unknown> },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await updateColumnSettings(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticColumn(vars.columnId, {
        settings: vars.settings as CacheColumn["settings"],
      });
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't update the column settings — your change was undone.",
        err,
      );
    },
  });

  const removeColumnOptionMutation = useMutation<
    unknown,
    Error,
    { columnId: string; optionId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await removeColumnOption(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    // Multi-entity optimistic change (column settings + every affected cell):
    // reconstructing a hand-written inverse is error-prone, so on failure we
    // resync the whole board from the server (rare error path) instead.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous) {
        const col = previous.columns.find((c) => c.id === vars.columnId);
        const opts = (
          (col?.settings as { options?: { id: string }[] })?.options ?? []
        ).filter((o) => o.id !== vars.optionId);
        let next = col
          ? replaceColumn(previous, {
              ...col,
              settings: {
                ...(col.settings as object),
                options: opts,
              } as CacheColumn["settings"],
            })
          : previous;
        next = {
          ...next,
          cellValues: next.cellValues
            .map((cv) =>
              cv.column_id === vars.columnId
                ? stripOption(cv, vars.optionId)
                : cv,
            )
            .filter((cv): cv is CacheCellValue => cv !== null),
        };
        qc.setQueryData(key, next);
      }
      return {};
    },
    onError: (err) => {
      resyncOnError();
      showMutationError(
        "Couldn't remove the option — your change was undone.",
        err,
      );
    },
  });

  const resizeColumnMutation = useMutation<
    unknown,
    Error,
    { columnId: string; width: number },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await resizeColumn(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticColumn(vars.columnId, { width: vars.width });
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't resize the column — your change was undone.",
        err,
      );
    },
  });

  const reorderColumnMutation = useMutation<
    unknown,
    Error,
    { columnId: string; position: number },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await reorderColumn(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    // replaceColumn re-sorts by position, so this one patch reflows every
    // group header, row, and the footer immediately.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticColumn(vars.columnId, { position: vars.position });
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't move the column — your change was undone.",
        err,
      );
    },
  });

  const deleteColumnMutation = useMutation<
    unknown,
    Error,
    { columnId: string },
    Ctx
  >({
    mutationFn: async (vars) => {
      const res = await deleteColumn(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    // Cascade delete (column + its cells): resync from the server on failure
    // rather than reconstruct the removed subtree by hand (rare error path).
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (previous)
        qc.setQueryData<BoardCache>(key, removeColumn(previous, vars.columnId));
      return {};
    },
    onError: (err) => {
      resyncOnError();
      showMutationError("Couldn't delete the column — it was restored.", err);
    },
  });

  return {
    addColumnMutation,
    renameColumnMutation,
    updateColumnSettingsMutation,
    removeColumnOptionMutation,
    resizeColumnMutation,
    reorderColumnMutation,
    deleteColumnMutation,
  };
}
