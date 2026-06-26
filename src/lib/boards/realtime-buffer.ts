import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  addDependency,
  insertColumn,
  insertGroup,
  insertItem,
  removeCellValue,
  removeColumn,
  removeDependency,
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
