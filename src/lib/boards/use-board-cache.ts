"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { BoardCache } from "@/lib/boards/cache";

export function boardKey(boardId: string) {
  return ["board", boardId] as const;
}

/**
 * Read the board cache. Hydrated from the server payload via `initialData`;
 * there is no `queryFn` because the cache is mutated optimistically and by the
 * Realtime channel — it is never refetched from the client.
 */
export function useBoardCache(boardId: string, initialData: BoardCache) {
  return useQuery({
    queryKey: boardKey(boardId),
    queryFn: () => initialData,
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
