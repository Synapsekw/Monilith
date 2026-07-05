import type { ParsedTable, ImportGroup, RowStructureEntry } from "./types";

/**
 * Orphan-subitem guard mirroring the client's `orphanGridIndices`: a subitem
 * with no item above it in the same group has no parent to attach to. The
 * client blocks this, but validate server-side too so a stale/forged payload
 * gets a friendly, row-numbered error instead of a promoted-silently import.
 *
 * Lives here (a pure, non-"use server" module) rather than in
 * `spreadsheet-actions.ts` so it can be exported for unit testing without
 * violating Next.js 16's rule that every export of a "use server" module be an
 * async Server Action.
 */
export function findStructureValidationError(
  table: ParsedTable,
  groups: ImportGroup[],
  structure: RowStructureEntry[],
): string | null {
  const byGrid = new Map(structure.map((s) => [s.gridIndex, s]));
  const fallbackKey = groups[0]?.key ?? "";
  const seenItemInGroup = new Set<string>();
  const orphanRows: number[] = [];

  for (const gridIndex of table.rowIndices) {
    const entry = byGrid.get(gridIndex) ?? {
      groupKey: fallbackKey,
      type: "item" as const,
    };
    if (entry.type === "subitem") {
      if (!seenItemInGroup.has(entry.groupKey)) orphanRows.push(gridIndex + 1);
    } else {
      seenItemInGroup.add(entry.groupKey);
    }
  }

  if (orphanRows.length === 0) return null;
  const shown = orphanRows.slice(0, 5).map((n) => `row ${n}`);
  const extra = orphanRows.length - shown.length;
  const list =
    extra > 0 ? `${shown.join(", ")}, +${extra} more` : shown.join(", ");
  return `${orphanRows.length} subitem row(s) have no item above them in their group (${list}). Make them items or move them under an item.`;
}
