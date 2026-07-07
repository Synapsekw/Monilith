import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  addDependency,
  insertColumn,
  insertGroup,
  insertItem,
  removeCellValue,
  removeColumn,
  removeDependency,
  removeGroup,
  removeItem,
  replaceColumn,
  replaceGroup,
  replaceItem,
  upsertCellValue,
  type BoardCache,
  type CacheCellValue,
  type CacheColumn,
  type CacheDependency,
  type CacheGroup,
  type CacheItem,
} from "@/lib/boards/cache";

export type BoardRealtimeEvent =
  | {
      table: "cell_values";
      payload: RealtimePostgresChangesPayload<CacheCellValue>;
    }
  | { table: "items"; payload: RealtimePostgresChangesPayload<CacheItem> }
  | {
      table: "item_dependencies";
      payload: RealtimePostgresChangesPayload<CacheDependency>;
    }
  | { table: "columns"; payload: RealtimePostgresChangesPayload<CacheColumn> }
  | { table: "groups"; payload: RealtimePostgresChangesPayload<CacheGroup> };

export type BoardFlash = { targetId: string; valueChanged: boolean };

/**
 * True when `row` is an older write than the `existing` cached cell, so folding
 * it would resurrect a stale value over a newer optimistic/realtime one. Only
 * fires when BOTH rows carry a parseable `updated_at` — a missing/garbage
 * timestamp is treated as "not stale" (apply it) so we never silently drop a
 * legitimate change (the board payload always includes updated_at).
 */
function isStaleEcho(
  existing: CacheCellValue | undefined,
  row: CacheCellValue,
): boolean {
  if (!existing?.updated_at || !row.updated_at) return false;
  const incoming = Date.parse(row.updated_at);
  const cached = Date.parse(existing.updated_at);
  if (Number.isNaN(incoming) || Number.isNaN(cached)) return false;
  return incoming < cached;
}

function applyCell(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheCellValue>,
  flashes: BoardFlash[],
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheCellValue>;
    if (oldRow.item_id && oldRow.column_id) {
      return removeCellValue(prev, oldRow.item_id, oldRow.column_id);
    }
    return prev;
  }
  const row = p.new as CacheCellValue;
  // Echo-dedupe: if the value already matches, skip (no re-render churn).
  const existing = prev.cellValues.find(
    (c) => c.item_id === row.item_id && c.column_id === row.column_id,
  );
  if (
    existing &&
    JSON.stringify(existing.value) === JSON.stringify(row.value)
  ) {
    return prev;
  }
  // Stale-echo guard: an out-of-order own-write echo can arrive AFTER a newer
  // optimistic value already sits in the cache. Skip it so the newer value
  // isn't transiently clobbered (the next fresh echo/refetch reconciles).
  if (isStaleEcho(existing, row)) return prev;
  flashes.push({
    targetId: `cell:${row.item_id}:${row.column_id}`,
    valueChanged: true,
  });
  return upsertCellValue(prev, row);
}

function applyItem(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheItem>,
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheItem>;
    return { ...prev, items: prev.items.filter((i) => i.id !== oldRow.id) };
  }
  const row = p.new as CacheItem;
  // An archive-UPDATE reads as a delete: drop the row (and its cascade) from the
  // cache so an archived item leaves every open board. An unarchive (archived_at
  // null) falls through to insert-if-absent / replace-if-present, so a peer's
  // undo/restore reappears live.
  if (row.archived_at != null) return removeItem(prev, row.id);
  return prev.items.some((i) => i.id === row.id)
    ? replaceItem(prev, row)
    : insertItem(prev, row);
}

function applyDependency(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheDependency>,
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheDependency>;
    return oldRow.id ? removeDependency(prev, oldRow.id) : prev;
  }
  return addDependency(prev, p.new as CacheDependency); // idempotent on id (echo-safe)
}

function applyColumn(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheColumn>,
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheColumn>;
    return oldRow.id ? removeColumn(prev, oldRow.id) : prev;
  }
  const row = p.new as CacheColumn;
  return prev.columns.some((c) => c.id === row.id)
    ? replaceColumn(prev, row)
    : insertColumn(prev, row);
}

function applyGroup(
  prev: BoardCache,
  p: RealtimePostgresChangesPayload<CacheGroup>,
): BoardCache {
  if (p.eventType === "DELETE") {
    const oldRow = p.old as Partial<CacheGroup>;
    return { ...prev, groups: prev.groups.filter((g) => g.id !== oldRow.id) };
  }
  const row = p.new as CacheGroup;
  // Archive-UPDATE ⇒ remove the group (and its items) from the cache; unarchive
  // (archived_at null) falls through to insert-if-absent / replace-if-present so a
  // peer's restore reappears live. Mirrors applyItem.
  if (row.archived_at != null) return removeGroup(prev, row.id);
  return prev.groups.some((g) => g.id === row.id)
    ? replaceGroup(prev, row)
    : insertGroup(prev, row);
}

/**
 * Fold a batch of realtime events over the board cache in order, returning the
 * new cache and the flash events for changed cells. Pure — no React, no query
 * client — so it is exhaustively unit-testable. The hook buffers events and
 * calls this once per animation frame.
 */
export function foldBoardEvents(
  prev: BoardCache,
  events: BoardRealtimeEvent[],
): { next: BoardCache; flashes: BoardFlash[] } {
  let next = prev;
  const flashes: BoardFlash[] = [];
  for (const ev of events) {
    switch (ev.table) {
      case "cell_values":
        next = applyCell(next, ev.payload, flashes);
        break;
      case "items":
        next = applyItem(next, ev.payload);
        break;
      case "item_dependencies":
        next = applyDependency(next, ev.payload);
        break;
      case "columns":
        next = applyColumn(next, ev.payload);
        break;
      case "groups":
        next = applyGroup(next, ev.payload);
        break;
    }
  }
  return { next, flashes };
}
