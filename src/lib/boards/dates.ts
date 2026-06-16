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
