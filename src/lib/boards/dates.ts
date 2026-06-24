import type { CacheCellValue, CacheColumn } from "@/lib/boards/cache";

export function resolveDateColumn(
  columns: CacheColumn[],
  config: { date_column_id?: string | null } | null | undefined,
): CacheColumn | null {
  const dateColumns = columns.filter((c) => c.kind === "date");
  const requested = config?.date_column_id
    ? dateColumns.find((c) => c.id === config.date_column_id)
    : undefined;
  return requested ?? dateColumns[0] ?? null;
}

export type DateRange = { start: string; end: string };

export function itemDateRange(
  itemId: string,
  cellValues: CacheCellValue[],
  dateColumnId: string,
): DateRange | null {
  const cell = cellValues.find(
    (c) => c.item_id === itemId && c.column_id === dateColumnId,
  );
  const value = cell?.value as { date?: string; end?: string } | undefined;
  if (!value?.date) return null;
  return { start: value.date, end: value.end ?? value.date };
}

export type TimelineSpan = { start: string; end: string; isMilestone: boolean };

/**
 * Resolve an item's timeline span from a start column and an optional end
 * column. When endColumnId is null, falls back to the start column's own
 * `.end` (legacy single-column range). See the timeline-spans design.
 */
export function resolveTimelineSpan(
  itemId: string,
  cellValues: CacheCellValue[],
  startColumnId: string,
  endColumnId: string | null,
): TimelineSpan | null {
  const startCell = cellValues.find(
    (c) => c.item_id === itemId && c.column_id === startColumnId,
  );
  const startVal = startCell?.value as
    | { date?: string; end?: string }
    | undefined;
  const startDate = startVal?.date;

  let endDate: string | undefined;
  if (endColumnId) {
    const endCell = cellValues.find(
      (c) => c.item_id === itemId && c.column_id === endColumnId,
    );
    endDate = (endCell?.value as { date?: string } | undefined)?.date;
  } else {
    endDate = startVal?.end;
  }

  if (!startDate && !endDate) return null;

  // Exactly one date → a milestone dot at that date.
  if (!startDate || !endDate) {
    const d = (startDate ?? endDate) as string;
    return { start: d, end: d, isMilestone: true };
  }

  // Inverted range → clamp to a dot at the start (never a negative-width bar).
  if (endDate < startDate) {
    return { start: startDate, end: startDate, isMilestone: true };
  }

  return { start: startDate, end: endDate, isMilestone: startDate === endDate };
}

/**
 * Pick sensible default start/end columns for a timeline view by column name.
 * Used only to seed the pickers when the view config has no explicit choice;
 * an explicit pick always overrides and is persisted.
 */
export function defaultTimelineColumns(
  dateColumns: { id: string; name: string }[],
): { startColumnId: string | null; endColumnId: string | null } {
  const startRe = /start|begin/i;
  const endRe = /due|end|finish|target/i;

  const start =
    dateColumns.find((c) => startRe.test(c.name)) ?? dateColumns[0] ?? null;
  const end =
    dateColumns.find((c) => endRe.test(c.name) && c.id !== start?.id) ?? null;

  return { startColumnId: start?.id ?? null, endColumnId: end?.id ?? null };
}
