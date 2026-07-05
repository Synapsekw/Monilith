import type { Tables } from "@/types/database.types";
import type { RelationLink } from "@/lib/boards/relations";

export type CacheBoard = Tables<"boards">;
export type CacheGroup = Tables<"groups">;
export type CacheItem = Tables<"items">;
export type CacheColumn = Tables<"columns">;
export type CacheCellValue = Tables<"cell_values">;
export type CacheDependency = Tables<"item_dependencies">;
export type CacheAttachment = Tables<"attachments">;
export type CacheTimeEntry = Tables<"time_entries">;

/** Client-side mirror of the server BoardPayload shape (no server-only deps). */
export type BoardCache = {
  board: CacheBoard;
  groups: CacheGroup[];
  columns: CacheColumn[];
  items: CacheItem[];
  cellValues: CacheCellValue[];
  dependencies: CacheDependency[];
  attachments: CacheAttachment[];
  timeEntries: CacheTimeEntry[];
  relationLinks: RelationLink[];
  /** (linked item, target column) values the caller can read, for mirror cells.
   *  Read-only at runtime (no mutators) — refreshed via revalidatePath re-hydration. */
  mirrorTargetCells: CacheCellValue[];
  /** Referenced target columns' render metadata (kind + settings). Read-only. */
  mirrorTargetColumns: Pick<CacheColumn, "id" | "kind" | "settings">[];
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

function byGroupPosition(a: CacheGroup, b: CacheGroup) {
  return a.position - b.position;
}

/** Replace a group by id (rename/recolor/reorder), keeping position order. Immutable. */
export function replaceGroup(cache: BoardCache, group: CacheGroup): BoardCache {
  return {
    ...cache,
    groups: cache.groups
      .map((g) => (g.id === group.id ? group : g))
      .sort(byGroupPosition),
  };
}

/** Replace an item by id (e.g. rename). No-op if absent. Immutable. */
export function replaceItem(cache: BoardCache, item: CacheItem): BoardCache {
  return {
    ...cache,
    items: cache.items.map((i) => (i.id === item.id ? item : i)),
  };
}

/**
 * Optimistically move a top-level item to another group: reassign its group_id,
 * set position to the provided value or append it after that group's current last
 * top-level item, and drag its subitems' denormalized group_id along (mirrors the
 * server's moveItem). The Realtime UPDATE echo reconciles the exact server position
 * afterwards. Immutable.
 */
export function moveItemToGroup(
  cache: BoardCache,
  itemId: string,
  groupId: string,
  position?: number,
): BoardCache {
  const maxPos = cache.items
    .filter((i) => i.group_id === groupId && i.parent_id === null)
    .reduce((m, i) => Math.max(m, i.position), 0);
  const nextPos = position ?? maxPos + 1;
  return {
    ...cache,
    items: cache.items.map((i) => {
      if (i.id === itemId)
        return { ...i, group_id: groupId, position: nextPos };
      if (i.parent_id === itemId) return { ...i, group_id: groupId };
      return i;
    }),
  };
}

/** Append an item; idempotent on id. Immutable. */
export function insertItem(cache: BoardCache, item: CacheItem): BoardCache {
  if (cache.items.some((i) => i.id === item.id)) return cache;
  return { ...cache, items: [...cache.items, item] };
}

/** Insert a group, keeping position order. No-op if the id already exists. Immutable. */
export function insertGroup(cache: BoardCache, group: CacheGroup): BoardCache {
  if (cache.groups.some((g) => g.id === group.id)) return cache;
  return { ...cache, groups: [...cache.groups, group].sort(byGroupPosition) };
}

/** Remove a group and its items + their cell values (mirrors the DB cascade). Immutable. */
export function removeGroup(cache: BoardCache, groupId: string): BoardCache {
  const itemIds = new Set(
    cache.items.filter((i) => i.group_id === groupId).map((i) => i.id),
  );
  return {
    ...cache,
    groups: cache.groups.filter((g) => g.id !== groupId),
    items: cache.items.filter((i) => i.group_id !== groupId),
    cellValues: cache.cellValues.filter((c) => !itemIds.has(c.item_id)),
  };
}

/** Remove an item, its subitems, and all their cell values (mirrors the DB cascade). Immutable. */
export function removeItem(cache: BoardCache, itemId: string): BoardCache {
  const itemIds = new Set<string>([itemId]);
  for (const i of cache.items) if (i.parent_id === itemId) itemIds.add(i.id);
  return {
    ...cache,
    items: cache.items.filter((i) => !itemIds.has(i.id)),
    cellValues: cache.cellValues.filter((c) => !itemIds.has(c.item_id)),
  };
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

/** Prepend a files-column attachment; idempotent on id (newest-first). Immutable. */
export function prependColumnFile(
  cache: BoardCache,
  a: CacheAttachment,
): BoardCache {
  if (cache.attachments.some((x) => x.id === a.id)) return cache;
  return { ...cache, attachments: [a, ...cache.attachments] };
}

/** Remove a files-column attachment by id. No-op if absent. Immutable. */
export function removeColumnFile(cache: BoardCache, id: string): BoardCache {
  return {
    ...cache,
    attachments: cache.attachments.filter((a) => a.id !== id),
  };
}

/** All attachments for a given (item, files-column) cell. */
export function filesForCell(
  cache: BoardCache,
  itemId: string,
  columnId: string,
): CacheAttachment[] {
  return cache.attachments.filter(
    (a) => a.item_id === itemId && a.column_id === columnId,
  );
}

/** All time entries for a given (item, time-tracking-column) cell. */
export function timeEntriesForCell(
  cache: BoardCache,
  itemId: string,
  columnId: string,
): CacheTimeEntry[] {
  return cache.timeEntries.filter(
    (t) => t.item_id === itemId && t.column_id === columnId,
  );
}

/** Prepend a time entry; idempotent on id (newest-first). Immutable. */
export function prependTimeEntry(
  cache: BoardCache,
  e: CacheTimeEntry,
): BoardCache {
  if (cache.timeEntries.some((t) => t.id === e.id)) return cache;
  return { ...cache, timeEntries: [e, ...cache.timeEntries] };
}

/** Insert-or-replace a time entry by id. Immutable. */
export function upsertTimeEntry(
  cache: BoardCache,
  e: CacheTimeEntry,
): BoardCache {
  const idx = cache.timeEntries.findIndex((t) => t.id === e.id);
  const timeEntries =
    idx === -1
      ? [e, ...cache.timeEntries]
      : cache.timeEntries.map((t, i) => (i === idx ? e : t));
  return { ...cache, timeEntries };
}

/** Remove a time entry by id. No-op if absent. Immutable. */
export function removeTimeEntry(cache: BoardCache, id: string): BoardCache {
  return {
    ...cache,
    timeEntries: cache.timeEntries.filter((t) => t.id !== id),
  };
}

/** All relation links for a given (item, relation-column) cell. */
export function relationLinksForCell(
  cache: BoardCache,
  itemId: string,
  columnId: string,
): RelationLink[] {
  return cache.relationLinks.filter(
    (l) => l.itemId === itemId && l.columnId === columnId,
  );
}

/** Replace a cell's relation links (used optimistically + after the server
 *  returns). Drops the cell's existing links and appends the new set. Immutable. */
export function setRelationLinksForCell(
  cache: BoardCache,
  itemId: string,
  columnId: string,
  links: RelationLink[],
): BoardCache {
  const others = cache.relationLinks.filter(
    (l) => !(l.itemId === itemId && l.columnId === columnId),
  );
  return { ...cache, relationLinks: [...others, ...links] };
}
