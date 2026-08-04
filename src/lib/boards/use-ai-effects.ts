"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { patchBoardCache } from "@/lib/boards/use-board-cache";
import { applyBoardEffect } from "@/lib/boards/ai-effects";
import type { BoardEffect } from "@/lib/ai/write/effects";

/**
 * Render an approved AI write on a mounted board — with NO server round-trip.
 *
 * The one hook both approve surfaces call. It works everywhere because
 * `patchBoardCache` is already written as `prev ? patch(prev) : prev`: when the
 * effect names a board with no mounted cache — /ask as a full page, or a write
 * to a board the user isn't looking at — the call is a silent no-op. That is
 * what removes any need to prop-drill "is a board on screen" or to branch per
 * surface.
 *
 * Deliberately not a navigation and not an invalidation: `router.refresh` would
 * re-run every query in the board page (gotcha-09), and revalidatePath would
 * invalidate a payload the mounted client discards (see the rule at
 * src/lib/boards/actions/group.ts).
 */
export function useApplyBoardEffects(): (
  effects: readonly BoardEffect[],
) => void {
  const qc = useQueryClient();
  return useCallback(
    (effects: readonly BoardEffect[]) => {
      for (const effect of effects) {
        patchBoardCache(qc, effect.boardId, (prev) =>
          applyBoardEffect(prev, effect),
        );
      }
    },
    [qc],
  );
}
