"use client";

import { useMutation } from "@tanstack/react-query";
import { clearCell, upsertCell } from "@/lib/boards/actions";
import {
  removeCellValue,
  upsertCellValue,
  type BoardCache,
  type CacheCellValue,
} from "@/lib/boards/cache";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type {
  BoardMutationCtx,
  ClearCellVars,
  Ctx,
  SetCellVars,
} from "./shared";
import { assertOnline } from "@/lib/offline/online-status";

/** Cell-value mutations: optimistic single-cell writes with targeted rollback. */
export function useCellMutations(ctx: BoardMutationCtx) {
  const { qc, key, rollback, cellRollback } = ctx;

  const setCellMutation = useMutation<unknown, Error, SetCellVars, Ctx>({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await upsertCell(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (!previous) return {};
      const prior = previous.cellValues.find(
        (c) => c.item_id === vars.itemId && c.column_id === vars.columnId,
      );
      const cell: CacheCellValue = {
        org_id: previous.board.org_id,
        board_id: previous.board.id,
        item_id: vars.itemId,
        column_id: vars.columnId,
        value: vars.value as CacheCellValue["value"],
        updated_at: new Date().toISOString(),
      };
      qc.setQueryData<BoardCache>(key, upsertCellValue(previous, cell));
      return { rollback: cellRollback(prior, vars.itemId, vars.columnId) };
    },
    onError: (err, _vars, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't save the cell — your change was undone.",
        err,
      );
    },
    onSettled: () => {
      // No refetch on the happy path: Realtime keeps the cache fresh (with
      // revalidatePath now dropped from hot-path mutations, the reconnect
      // resync + targeted rollback are what keep the cache correct).
    },
  });

  const clearCellMutation = useMutation<unknown, Error, ClearCellVars, Ctx>({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await clearCell(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BoardCache>(key);
      if (!previous) return {};
      const prior = previous.cellValues.find(
        (c) => c.item_id === vars.itemId && c.column_id === vars.columnId,
      );
      qc.setQueryData<BoardCache>(
        key,
        removeCellValue(previous, vars.itemId, vars.columnId),
      );
      return { rollback: cellRollback(prior, vars.itemId, vars.columnId) };
    },
    onError: (err, _vars, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't clear the cell — your change was undone.",
        err,
      );
    },
  });

  return { setCellMutation, clearCellMutation };
}
