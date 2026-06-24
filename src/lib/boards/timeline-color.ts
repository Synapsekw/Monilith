import type { CacheCellValue, CacheColumn } from "@/lib/boards/cache";

/** Bar/dot fill for items with no value in the chosen color column. */
export const TIMELINE_NEUTRAL_COLOR = "#c4c7d0";

type OptionSettings = {
  options?: { id: string; label: string; color: string }[];
};

/**
 * Resolve the bar/dot color for one item from a status/dropdown column's
 * option palette. Returns null when no color column is selected (caller falls
 * back to the single accent). Missing or unmatched value → neutral gray.
 */
export function colorForItem(
  itemId: string,
  colorColumn: CacheColumn | null,
  cellValues: CacheCellValue[],
): string | null {
  if (!colorColumn) return null;

  const settings = (colorColumn.settings ?? {}) as OptionSettings;
  const options = settings.options ?? [];

  const cell = cellValues.find(
    (c) => c.item_id === itemId && c.column_id === colorColumn.id,
  );
  const value = cell?.value as
    | { optionId?: string | null; optionIds?: string[] }
    | undefined;

  const optionId =
    colorColumn.kind === "status"
      ? (value?.optionId ?? null)
      : (value?.optionIds?.[0] ?? null);

  if (!optionId) return TIMELINE_NEUTRAL_COLOR;
  return (
    options.find((o) => o.id === optionId)?.color ?? TIMELINE_NEUTRAL_COLOR
  );
}
