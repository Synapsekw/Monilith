import type { Tables } from "@/types/database.types";
import { cellKey } from "@/lib/boards/cache";
import type { LinkedItemStatus } from "@/lib/boards/relation-status";

export type RelationLinkRow = Tables<"relation_links">;

/** A relation link as the UI consumes it (linked name resolved client-side). */
export type RelationLink = {
  id: string;
  itemId: string;
  columnId: string;
  linkedItemId: string;
  /** null when the target board is not readable by the caller (RLS-filtered). */
  linkedItemName: string | null;
  /** The linked item's status on its own board, for colouring the chip. Absent
   *  or null when it has none, or for a link added optimistically. */
  linkedItemStatus?: LinkedItemStatus | null;
  position: number;
};

/** Sort links by stored position (stable for chip rendering). */
export function sortLinks(links: RelationLink[]): RelationLink[] {
  return [...links].sort((a, b) => a.position - b.position);
}

/** Collapsed-parent rollup label, e.g. "3 linked" / "1 linked" / "". */
export function relationRollup(links: RelationLink[]): string {
  const n = new Set(links.map((l) => l.linkedItemId)).size;
  return n === 0 ? "" : `${n} linked`;
}

/**
 * A relation cell as plain text: the linked item names, in link `position`
 * order, joined with ", ". Links live in `relation_links` rather than
 * `cell_values`, so this is what lets the consumers that read a cell VALUE
 * (board filter / sort / quick search, spreadsheet export) see a relation
 * column at all. A link whose name is null (target not readable under RLS)
 * contributes nothing; a cell left with no visible name is omitted — it reads
 * as empty.
 */
export type RelationCellText = {
  itemId: string;
  columnId: string;
  text: string;
};

/** The same-shaped value a text cell stores, so `v.text` consumers just work. */
export type RelationTextValue = { text: string };

/** One entry per relation cell that has at least one visible linked name.
 *  O(links) plus a per-cell sort — never a scan over the board's rows. */
export function relationCellTexts(
  links: readonly RelationLink[],
): RelationCellText[] {
  const byCell = new Map<string, RelationLink[]>();
  for (const link of links) {
    const key = cellKey(link.itemId, link.columnId);
    const bucket = byCell.get(key);
    if (bucket) bucket.push(link);
    else byCell.set(key, [link]);
  }
  const out: RelationCellText[] = [];
  for (const bucket of byCell.values()) {
    const text = sortLinks(bucket)
      .map((l) => l.linkedItemName)
      .filter((name): name is string => name !== null && name !== "")
      .join(", ");
    if (text === "") continue;
    out.push({ itemId: bucket[0].itemId, columnId: bucket[0].columnId, text });
  }
  return out;
}

/** {@link relationCellTexts} keyed by `cellKey(itemId, columnId)`. */
export function relationTextByCell(
  links: readonly RelationLink[],
): Map<string, RelationTextValue> {
  const map = new Map<string, RelationTextValue>();
  for (const cell of relationCellTexts(links)) {
    map.set(cellKey(cell.itemId, cell.columnId), { text: cell.text });
  }
  return map;
}

/**
 * A cell map with relation text overlaid, for the filter / sort context. Never
 * mutates `cellMap` (the board still renders from the original); returns it
 * unchanged when there is nothing to overlay, so a board without relation
 * links pays nothing.
 *
 * `links` tolerates a missing array: this runs on every board render, and a
 * board cache built from a payload without `relationLinks` (older fixtures,
 * partial payloads) must still filter rather than crash the view.
 */
export function withRelationText<V>(
  cellMap: Map<string, V>,
  links: readonly RelationLink[] | null | undefined,
): Map<string, V | RelationTextValue> {
  if (!links || links.length === 0) return cellMap;
  const overlay = relationTextByCell(links);
  if (overlay.size === 0) return cellMap;
  const out = new Map<string, V | RelationTextValue>(cellMap);
  for (const [key, value] of overlay) out.set(key, value);
  return out;
}

/**
 * Relation cells in the `{ column_id, value }` shape the column auto-fit reads,
 * so a relation column is sized to its chips like any other column.
 */
export function relationFitValues(
  links: readonly RelationLink[] | undefined,
): { column_id: string; value: RelationTextValue }[] {
  if (!links || links.length === 0) return [];
  return relationCellTexts(links).map((c) => ({
    column_id: c.columnId,
    value: { text: c.text },
  }));
}
