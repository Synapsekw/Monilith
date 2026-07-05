import { midpoint } from "@/lib/boards/position";

/**
 * Float `position` for inserting an item next to `overId` within a target
 * group's position-ordered top-level items. `dropBelow` = drop the active row
 * *after* `overId` (insert below it); otherwise *before*. Ends prepend/append
 * via midpoint's null boundaries. Unknown `overId` (e.g. dropped on the group
 * container, not a row) → append after the last row.
 */
export function crossGroupInsertPosition(
  targetItems: readonly { id: string; position: number }[],
  overId: string,
  dropBelow: boolean,
): number {
  const ordered = [...targetItems].sort((a, b) => a.position - b.position);
  const idx = ordered.findIndex((i) => i.id === overId);
  if (idx === -1) {
    const last = ordered[ordered.length - 1]?.position ?? null;
    return midpoint(last, null);
  }
  if (dropBelow) {
    const after = ordered[idx + 1]?.position ?? null;
    return midpoint(ordered[idx].position, after);
  }
  const before = ordered[idx - 1]?.position ?? null;
  return midpoint(before, ordered[idx].position);
}
