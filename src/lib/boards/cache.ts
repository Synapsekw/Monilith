import type { Tables } from "@/types/database.types";

export type CacheBoard = Tables<"boards">;
export type CacheGroup = Tables<"groups">;
export type CacheItem = Tables<"items">;
export type CacheColumn = Tables<"columns">;
export type CacheCellValue = Tables<"cell_values">;

/** Client-side mirror of the server BoardPayload shape (no server-only deps). */
export type BoardCache = {
  board: CacheBoard;
  groups: CacheGroup[];
  columns: CacheColumn[];
  items: CacheItem[];
  cellValues: CacheCellValue[];
};

/** Insert or replace a cell value keyed by (item_id, column_id). Immutable. */
export function upsertCellValue(
  cache: BoardCache,
  cell: CacheCellValue,
): BoardCache {
  const idx = cache.cellValues.findIndex(
    (c) => c.item_id === cell.item_id && c.column_id === cell.column_id,
  );
  const cellValues =
    idx === -1
      ? [...cache.cellValues, cell]
      : cache.cellValues.map((c, i) => (i === idx ? cell : c));
  return { ...cache, cellValues };
}

/** Remove the cell value for (item_id, column_id). No-op if absent. Immutable. */
export function removeCellValue(
  cache: BoardCache,
  itemId: string,
  columnId: string,
): BoardCache {
  return {
    ...cache,
    cellValues: cache.cellValues.filter(
      (c) => !(c.item_id === itemId && c.column_id === columnId),
    ),
  };
}

/** Replace an item by id (e.g. rename). No-op if absent. Immutable. */
export function replaceItem(cache: BoardCache, item: CacheItem): BoardCache {
  return {
    ...cache,
    items: cache.items.map((i) => (i.id === item.id ? item : i)),
  };
}

/** Append an item; idempotent on id. Immutable. */
export function insertItem(cache: BoardCache, item: CacheItem): BoardCache {
  if (cache.items.some((i) => i.id === item.id)) return cache;
  return { ...cache, items: [...cache.items, item] };
}
