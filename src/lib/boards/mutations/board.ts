"use client";

import { useMutation } from "@tanstack/react-query";
import { renameBoard, resizeNameColumn } from "@/lib/boards/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import type {
  BoardMutationCtx,
  Ctx,
  RenameBoardVars,
  ResizeNameColumnVars,
} from "./shared";
import { assertOnline } from "@/lib/offline/online-status";

/** Board-row mutations: rename + name-column resize (singleton board fields). */
export function useBoardRowMutations(ctx: BoardMutationCtx) {
  const { qc, key, boardId, rollback, optimisticBoardField } = ctx;

  const renameBoardMutation = useMutation<unknown, Error, RenameBoardVars, Ctx>(
    {
      mutationFn: async (vars) => {
        assertOnline();
        const res = await renameBoard({ boardId, name: vars.name });
        if (!res.ok) throw new Error(res.error);
        return res;
      },
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: key });
        return optimisticBoardField({ name: vars.name });
      },
      onError: (err, _vars, ctx) => {
        rollback(ctx);
        showMutationError(
          "Couldn't rename the board — your change was undone.",
          err,
        );
      },
    },
  );

  const resizeNameColumnMutation = useMutation<
    unknown,
    Error,
    ResizeNameColumnVars,
    Ctx
  >({
    mutationFn: async (vars) => {
      assertOnline();
      const res = await resizeNameColumn({ boardId, width: vars.width });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      return optimisticBoardField({ name_column_width: vars.width });
    },
    onError: (err, _vars, ctx) => {
      rollback(ctx);
      showMutationError(
        "Couldn't resize the column — your change was undone.",
        err,
      );
    },
  });

  return { renameBoardMutation, resizeNameColumnMutation };
}
