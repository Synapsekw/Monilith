"use client";

import { useState } from "react";

/**
 * Referentially-stable id array for dnd-kit's `SortableContext`.
 *
 * dnd-kit puts `items` in its context memo deps, so a NEW array — even one with
 * identical contents — publishes a new sortable context value and re-renders
 * every `useSortable` consumer, i.e. every visible row BODY. (The memoized cells
 * under those bodies still bail out, which is why a per-cell render probe cannot
 * see it.) The board's id arrays are derived from `visibleItemsByGroup`, whose
 * memo deps include `cellMap` — the filter predicate and the sort comparator
 * both read cell values — so a single-cell patch recomputed content-equal
 * arrays and churned the context.
 *
 * This keeps the previous array while its contents are unchanged, so the
 * identity only moves when the ORDER or MEMBERSHIP actually moves.
 *
 * Implemented with the "adjust state during render" pattern rather than a ref:
 * reading or writing a ref during render is what `react-hooks/refs` forbids, and
 * the extra render pass only happens on the renders where the ids really changed
 * — exactly the renders the consumers had to re-run anyway.
 */
export function useStableIds(ids: string[]): string[] {
  const [stable, setStable] = useState(ids);
  if (sameIds(stable, ids)) return stable;
  setStable(ids);
  return ids;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
