import type { Tables } from "@/types/database.types";

export type CacheBoard = Tables<"boards">;
export type CacheGroup = Tables<"groups">;
export type CacheItem = Tables<"items">;
export type CacheColumn = Tables<"columns">;
export type CacheCellValue = Tables<"cell_values">;
export type CacheDependency = Tables<"item_dependencies">;

/** Client-side mirror of the server BoardPayload shape (no server-only deps). */
export type BoardCache = {
  board: CacheBoard;
  groups: CacheGroup[];
  columns: CacheColumn[];
  items: CacheItem[];
  cellValues: CacheCellValue[];
  dependencies: CacheDependency[];
};

/** Stable lookup key for a cell value (item + column). */
export function cellKey(itemId: string, columnId: string): string {
  return `${itemId}:${columnId}`;
}

/** Build an O(1) `${item_id}:${column_id}` → value map from cell values. */
export function buildCellMap(
  cellValues: readonly CacheCellValue[],
): Map<string, CacheCellValue["value"]> {
  const map = new Map<string, CacheCellValue["value"]>();
  for (const c of cellValues) map.set(cellKey(c.item_id, c.column_id), c.value);
  return map;
}

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

/** Replace the board row (e.g. rename). Immutable. */
export function replaceBoard(cache: BoardCache, board: CacheBoard): BoardCache {
  return { ...cache, board };
}

/** Replace a group by id (e.g. rename). No-op if absent. Immutable. */
export function replaceGroup(cache: BoardCache, group: CacheGroup): BoardCache {
  return {
    ...cache,
    groups: cache.groups.map((g) => (g.id === group.id ? group : g)),
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

/** Append a dependency; idempotent on id. Immutable. */
export function addDependency(
  cache: BoardCache,
  dep: CacheDependency,
): BoardCache {
  if (cache.dependencies.some((d) => d.id === dep.id)) return cache;
  return { ...cache, dependencies: [...cache.dependencies, dep] };
}

/** Remove a dependency by id. No-op if absent. Immutable. */
export function removeDependency(cache: BoardCache, id: string): BoardCache {
  return {
    ...cache,
    dependencies: cache.dependencies.filter((d) => d.id !== id),
  };
}

function byPosition(a: CacheColumn, b: CacheColumn) {
  return a.position - b.position;
}

/** Insert a column, keeping position order. No-op if the id already exists. */
export function insertColumn(cache: BoardCache, col: CacheColumn): BoardCache {
  if (cache.columns.some((c) => c.id === col.id)) return cache;
  return { ...cache, columns: [...cache.columns, col].sort(byPosition) };
}

/** Replace a column by id (rename/width/settings), keeping position order. */
export function replaceColumn(cache: BoardCache, col: CacheColumn): BoardCache {
  return {
    ...cache,
    columns: cache.columns
      .map((c) => (c.id === col.id ? col : c))
      .sort(byPosition),
  };
}

/** Remove a column and its cell values (mirrors the DB cascade). Immutable. */
export function removeColumn(cache: BoardCache, columnId: string): BoardCache {
  return {
    ...cache,
    columns: cache.columns.filter((c) => c.id !== columnId),
    cellValues: cache.cellValues.filter((c) => c.column_id !== columnId),
  };
}
