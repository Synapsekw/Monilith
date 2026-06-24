import type { CacheCellValue } from "@/lib/boards/cache";
import { itemDateRange } from "@/lib/boards/dates";

export type AgendaItem = {
  itemId: string;
  name: string;
  range: { start: string; end: string };
};

export type AgendaGroup = {
  dateISO: string;
  items: AgendaItem[];
};

/**
 * Group items by day within [fromISO, toISO], chronologically. Only days that
 * have items are returned. An item that began before the window anchors on
 * fromISO; items entirely outside the window are excluded.
 */
export function agendaGroups(
  fromISO: string,
  toISO: string,
  items: { id: string; name: string }[],
  cellValues: CacheCellValue[],
  dateColumnId: string,
): AgendaGroup[] {
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const range = itemDateRange(item.id, cellValues, dateColumnId);
    if (!range) continue;
    if (range.end < fromISO || range.start > toISO) continue;
    const anchor = range.start < fromISO ? fromISO : range.start;
    const list = byDay.get(anchor) ?? [];
    list.push({ itemId: item.id, name: item.name, range });
    byDay.set(anchor, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dateISO, items]) => ({ dateISO, items }));
}
