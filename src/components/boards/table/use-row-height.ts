"use client";

import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { COARSE_ROW_HEIGHT, ROW_HEIGHT, SUBITEM_ROW_HEIGHT } from "./shared";

export type RowHeights = { item: number; subitem: number };

const FINE: RowHeights = { item: ROW_HEIGHT, subitem: SUBITEM_ROW_HEIGHT };
const COARSE: RowHeights = {
  item: COARSE_ROW_HEIGHT,
  subitem: COARSE_ROW_HEIGHT,
};

/**
 * The one source of row height for the board table. Row markup sets it as an
 * inline `height`, and the virtualizer's `estimateSize` reads the same value,
 * so the two cannot drift. Fine pointers get the dense 28 / 26; coarse
 * pointers get 44 for both. `useCoarsePointer` reports `false` on the server
 * and during hydration, so the first paint is the dense layout and a touch
 * device re-renders once to 44 (rows are still measured by `measureElement`).
 */
export function useRowHeight(): RowHeights {
  return useCoarsePointer() ? COARSE : FINE;
}
