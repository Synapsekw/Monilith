"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { BoardCache } from "@/lib/boards/cache";
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
    queryFn: async () => {
      const payload = await fetchBoardPayload(boardId);
      // Board vanished (deleted / RLS): keep the last-known cache rather than
      // clobbering it with null. React Query preserves prior data on a thrown
      // background refetch, so the board stays usable until the user leaves.
      if (!payload) throw new Error("Board is no longer available");
      return payload as unknown as BoardCache;
    },
    initialData,
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
