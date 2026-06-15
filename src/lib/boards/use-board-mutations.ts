"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clearCell, upsertCell } from "@/lib/boards/actions";
import {
  removeCellValue,
  upsertCellValue,
  type BoardCache,
  type CacheCellValue,
} from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";

type SetCellVars = { itemId: string; columnId: string; value: unknown };
type ClearCellVars = { itemId: string; columnId: string };
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

  return {
    setCell: (vars: SetCellVars) => setCellMutation.mutate(vars),
    clearCellValue: (vars: ClearCellVars) => clearCellMutation.mutate(vars),
  };
}
