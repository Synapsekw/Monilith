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
import type { WorkTrackingSettings } from "@/components/boards/WorkTrackingDialog";
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

  // Work-tracking settings are saved by the dialog itself (it needs the action's
  // error text and pending state), so this only mirrors a SUCCESSFUL save into
  // the shared cache: every header instance (one per view) and any later Save
  // then start from the saved values. Same field-precise board-row patch the
  // rename uses; the rollback it returns is unused (nothing is optimistic).
  function applyWorkSettings(saved: WorkTrackingSettings) {
    optimisticBoardField({
      work_status_column_id: saved.statusColumnId,
      work_done_option_ids: saved.doneOptionIds,
      work_due_column_id: saved.dueColumnId,
    });
  }

  return { renameBoardMutation, resizeNameColumnMutation, applyWorkSettings };
}
