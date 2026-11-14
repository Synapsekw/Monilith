"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  addDependency,
  type BoardCache,
  type CacheDependency,
} from "@/lib/boards/cache";
import { fetchBoardPayload } from "@/lib/boards/board-payload-action";

export function boardKey(boardId: string) {
  return ["board", boardId] as const;
}

/**
 * Read the board cache. Hydrated from the server payload via `initialData`, so
 * first paint does NO refetch (`staleTime: Infinity` keeps the seeded data
 * fresh). The cache is normally mutated optimistically + by the Realtime
 * channel; the `queryFn` exists only so an explicit `invalidateQueries` — fired
 * by the realtime hook when the channel re-subscribes after a drop — can resync
 * the full board from the server (recovering any collaborator edits missed
 * during the gap). It re-reads the same bounded `getBoardPayload` projection.
 */
export function useBoardCache(boardId: string, initialData: BoardCache) {
  return useQuery({
    queryKey: boardKey(boardId),
    queryFn: () => fetchBoardCache(boardId),
    initialData,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

async function fetchBoardCache(boardId: string): Promise<BoardCache> {
  const payload = await fetchBoardPayload(boardId);
  // Board vanished (deleted / RLS): keep the last-known cache rather than
  // clobbering it with null. React Query preserves prior data on a thrown
  // background refetch, so the board stays usable until the user leaves.
  if (!payload) throw new Error("Board is no longer available");
  return payload;
}

/**
 * Subscribe to a board cache some board view already hydrated, without ever
 * fetching it from here (`enabled: false`; `data` is undefined until loaded).
 * It still carries the shared `queryFn`, so it never logs TanStack's missing-
 * queryFn error and a resync `invalidateQueries` keeps working.
 */
export function useLoadedBoardCache(boardId: string) {
  return useQuery({
    queryKey: boardKey(boardId),
    queryFn: () => fetchBoardCache(boardId),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Imperatively patch the board cache (used by mutations + realtime). */
export function patchBoardCache(
  qc: QueryClient,
  boardId: string,
  patch: (prev: BoardCache) => BoardCache,
) {
  qc.setQueryData<BoardCache>(boardKey(boardId), (prev) =>
    prev ? patch(prev) : prev,
  );
}

/**
 * Put a just-created dependency into every loaded board cache that shows it:
 * the successor's board (`board_id`) and the predecessor's. Unloaded boards are
 * left alone (they hydrate with it). Same idempotent-on-id merge the realtime
 * handler uses, so a later echo can't double-insert.
 */
export function addDependencyToBoardCaches(
  qc: QueryClient,
  dep: CacheDependency,
) {
  for (const boardId of new Set([dep.board_id, dep.predecessor_board_id]))
    patchBoardCache(qc, boardId, (prev) => addDependency(prev, dep));
}
