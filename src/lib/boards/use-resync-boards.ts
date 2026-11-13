"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { boardKey } from "@/lib/boards/use-board-cache";

/**
 * Refetch each touched board once, after the assistant applied changes to it.
 *
 * Catalog tools return text, not rows, so there is nothing to patch into the
 * cache the way `useApplyBoardEffects` does. An invalidation refetches a
 * MOUNTED board and is a no-op for one that is not on screen. It is one
 * round-trip per touched board, after an explicit Apply that changed server
 * data. Not a navigation: no `router.refresh()`, no `revalidatePath`.
 */
export function useResyncBoards(): (boardIds: readonly string[]) => void {
  const qc = useQueryClient();
  return useCallback(
    (boardIds: readonly string[]) => {
      for (const id of new Set(boardIds))
        void qc.invalidateQueries({ queryKey: boardKey(id) });
    },
    [qc],
  );
}
