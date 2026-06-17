"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  addDependency,
  insertColumn,
  insertItem,
  removeCellValue,
  removeColumn,
  removeDependency,
  replaceColumn,
  replaceItem,
  upsertCellValue,
  type BoardCache,
  type CacheCellValue,
  type CacheColumn,
  type CacheDependency,
  type CacheItem,
} from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";

/**
 * Subscribe one Realtime channel for the board, reconciling cell_values + items
 * (+ groups/columns) changes into the ["board", boardId] cache. De-dupes echoes
 * from our own optimistic writes by skipping no-op cell value patches.
 */
export function useBoardRealtime(boardId: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const supabase = createClient();
    const filter = `board_id=eq.${boardId}`;
    // Computed inside the effect: boardKey() returns a fresh array each render,
    // so keeping it out of the dep list avoids resubscribing on every render.
    const key = boardKey(boardId);

    function patch(fn: (prev: BoardCache) => BoardCache) {
      qc.setQueryData<BoardCache>(key, (prev) => (prev ? fn(prev) : prev));
    }

    function onCell(p: RealtimePostgresChangesPayload<CacheCellValue>) {
      if (p.eventType === "DELETE") {
        const oldRow = p.old as Partial<CacheCellValue>;
        if (oldRow.item_id && oldRow.column_id) {
          patch((prev) =>
            removeCellValue(prev, oldRow.item_id!, oldRow.column_id!),
          );
        }
        return;
      }
      const row = p.new as CacheCellValue;
      patch((prev) => {
        // Echo-dedupe: if the value already matches, skip (no re-render churn).
        const existing = prev.cellValues.find(
          (c) => c.item_id === row.item_id && c.column_id === row.column_id,
        );
        if (
          existing &&
          JSON.stringify(existing.value) === JSON.stringify(row.value)
        )
          return prev;
        return upsertCellValue(prev, row);
      });
    }

    function onItem(p: RealtimePostgresChangesPayload<CacheItem>) {
      if (p.eventType === "DELETE") {
        const oldRow = p.old as Partial<CacheItem>;
        patch((prev) => ({
          ...prev,
          items: prev.items.filter((i) => i.id !== oldRow.id),
        }));
        return;
      }
      const row = p.new as CacheItem;
      patch((prev) =>
        prev.items.some((i) => i.id === row.id)
          ? replaceItem(prev, row)
          : insertItem(prev, row),
      );
    }

    function onDependency(p: RealtimePostgresChangesPayload<CacheDependency>) {
      if (p.eventType === "DELETE") {
        const oldRow = p.old as Partial<CacheDependency>;
        if (oldRow.id) patch((prev) => removeDependency(prev, oldRow.id!));
        return;
      }
      const row = p.new as CacheDependency;
      patch((prev) => addDependency(prev, row)); // idempotent on id (echo-safe)
    }

    function onColumn(p: RealtimePostgresChangesPayload<CacheColumn>) {
      if (p.eventType === "DELETE") {
        const oldRow = p.old as Partial<CacheColumn>;
        if (oldRow.id) patch((prev) => removeColumn(prev, oldRow.id!));
        return;
      }
      const row = p.new as CacheColumn;
      patch((prev) =>
        prev.columns.some((c) => c.id === row.id)
          ? replaceColumn(prev, row)
          : insertColumn(prev, row),
      );
    }

    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cell_values", filter },
        onCell,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "items", filter },
        onItem,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_dependencies", filter },
        onDependency,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "columns", filter },
        onColumn,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [boardId, qc]);
}
