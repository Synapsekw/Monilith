import {
  insertGroup,
  insertItem,
  upsertCellValue,
  type BoardCache,
} from "@/lib/boards/cache";
import type { BoardEffect } from "@/lib/ai/write/effects";

/**
 * Fold one approved AI write onto the board cache.
 *
 * Pure — no React, no query client — so it is exhaustively unit-testable, the
 * same shape as `foldBoardEvents` in realtime-buffer.ts. Every mutator it uses
 * is already id-idempotent, which is what lets a later Realtime echo of the SAME
 * write land harmlessly on top.
 *
 * Note it does NOT reuse `moveItemToGroup`: that helper GUESSES a position
 * (`maxPos + 1`) because drag-and-drop patches before the server answers. Here
 * the server has already answered, so the authoritative row is written directly.
 */
export function applyBoardEffect(
  cache: BoardCache,
  effect: BoardEffect,
): BoardCache {
  switch (effect.kind) {
    case "item_created": {
      let next = insertItem(cache, effect.item);
      for (const cell of effect.cells) next = upsertCellValue(next, cell);
      return next;
    }
    case "item_moved": {
      // One pass over items so the parent's authoritative row and its subitems'
      // denormalized group_id land together. An id the cache has never seen
      // simply doesn't match — a write outside the loaded projection must not
      // invent a row.
      const subitems = new Set(effect.subitemIds);
      return {
        ...cache,
        items: cache.items.map((i) => {
          if (i.id === effect.item.id) return effect.item;
          if (subitems.has(i.id))
            return { ...i, group_id: effect.item.group_id };
          return i;
        }),
      };
    }
    case "item_fields_set": {
      let next = cache;
      for (const cell of effect.cells) next = upsertCellValue(next, cell);
      return next;
    }
    case "group_created":
      return insertGroup(cache, effect.group);
  }
}
