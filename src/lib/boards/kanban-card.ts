import type { CacheColumn } from "@/lib/boards/cache";
import { effectivePriority } from "@/lib/boards/priority";

/**
 * Column kinds rendered as colored status pills on a Kanban card — the one
 * sanctioned place for option color (see pulse-ui). Priority joins the zone
 * but renders only when effectively Critical (see isCardCellEmpty).
 */
const PILL_KINDS = new Set(["status", "dropdown", "priority"]);

/**
 * Column kinds surfaced in the quiet, icon-prefixed meta footer of a Kanban
 * card. Each reads as metadata (date · people · percent · number), not a label.
 */
const META_KINDS = new Set([
  "date",
  "people",
  "percent",
  "numbers",
  "currency",
]);

export type CardColumns = { pills: CacheColumn[]; meta: CacheColumn[] };

/**
 * Choose and split the columns surfaced on a Kanban card into two visual zones:
 * - `pills`: status/dropdown columns (colored labels), shown on their own row.
 * - `meta`: date/people/percent/number columns, shown in the footer with icons.
 *
 * The grouping column is excluded because the lane already represents it, and
 * non-card kinds (text, link, files, …) are dropped to keep cards scannable.
 * Board column order is preserved within each zone.
 */
export function selectCardColumns(
  columns: CacheColumn[],
  groupColumnId: string,
): CardColumns {
  const pills: CacheColumn[] = [];
  const meta: CacheColumn[] = [];
  for (const col of columns) {
    if (col.id === groupColumnId) continue;
    if (PILL_KINDS.has(col.kind)) pills.push(col);
    else if (META_KINDS.has(col.kind)) meta.push(col);
  }
  return { pills, meta };
}

/**
 * Whether a card cell has no value worth rendering, so the card can skip the
 * field entirely (no lonely icon, no empty pill) rather than reserve space for
 * it. Mirrors the per-kind "empty" checks the cell renderers use internally.
 */
export function isCardCellEmpty(
  kind: string,
  value: unknown,
  /** Priority cells only: direct dependents of the item. */
  dependents = 0,
): boolean {
  // Cards surface priority only when it is effectively Critical — an explicit
  // Normal or unset cell renders nothing (scannability). Checked before the
  // null short-circuit: an unset cell with 2+ dependents is NOT empty.
  if (kind === "priority")
    return effectivePriority(value, dependents).level !== "critical";
  if (value == null) return true;
  const v = value as Record<string, unknown>;
  switch (kind) {
    case "status":
      return v.optionId == null;
    case "dropdown":
      return !Array.isArray(v.optionIds) || v.optionIds.length === 0;
    case "date":
      return !v.date;
    case "people":
      return !Array.isArray(v.userIds) || v.userIds.length === 0;
    case "percent":
      return typeof v.percent !== "number";
    case "numbers":
      return typeof v.n !== "number";
    case "currency":
      return typeof v.amount !== "number";
    default:
      return false;
  }
}
