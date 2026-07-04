"use server";

import { z } from "zod";
import { getBoardPayload, type BoardPayload } from "@/lib/boards/queries";

const boardIdSchema = z.string().uuid();

/**
 * Client-callable wrapper around the RLS-scoped, bounded {@link getBoardPayload}
 * read. This is the board cache's `queryFn`: it is NOT used on first paint
 * (the page seeds the cache via `initialData`), only when the realtime hook
 * invalidates the query to resync after a channel drop/reconnect.
 *
 * Reuses `getBoardPayload` verbatim, so the same first-paint bounds apply
 * (items 5000 / cell_values 20000 / deps 5000 / attachments 200 / entries 1000)
 * — no unbounded read is introduced. Returns null when the board is no longer
 * visible (RLS) or was deleted; the caller keeps the last-known cache in that
 * case rather than clearing it.
 */
export async function fetchBoardPayload(
  boardId: string,
): Promise<BoardPayload | null> {
  const parsed = boardIdSchema.safeParse(boardId);
  if (!parsed.success) return null;
  return getBoardPayload(parsed.data);
}
