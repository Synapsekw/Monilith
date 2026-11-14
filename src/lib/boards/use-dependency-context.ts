"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getBoardDependencyContext } from "@/lib/boards/dependency-actions";
import type { DependencyContext } from "@/lib/boards/timeline-context";

const EMPTY: DependencyContext = { boards: [], items: [] };

export const dependencyContextKey = (boardId: string) =>
  ["board-dep-context", boardId] as const;

/** Foreign ends of this board's cross-board links. No request for same-board-only boards. */
export function useDependencyContext(
  boardId: string,
  dependencies: readonly {
    board_id: string;
    predecessor_board_id: string;
    predecessor_id: string;
    successor_id: string;
  }[],
): { data: DependencyContext | undefined; isPending: boolean } {
  // The sorted set of foreign item ids is part of the key, so any change to
  // which foreign items are linked (add, remove, swap — via realtime) refetches
  // the context once. A count would collide: remove X then add Y returns to
  // the same key and serves a cached context that has no Y.
  const foreign = new Set<string>();
  for (const d of dependencies) {
    if (d.board_id === d.predecessor_board_id) continue;
    foreign.add(d.board_id === boardId ? d.predecessor_id : d.successor_id);
  }
  const foreignKey = [...foreign].sort().join(",");
  const q = useQuery({
    queryKey: [...dependencyContextKey(boardId), foreignKey],
    queryFn: async () => {
      const res = await getBoardDependencyContext({ boardId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: foreign.size > 0,
    staleTime: 60_000,
    // Keep the previous context while the new key loads, so existing foreign
    // entries and stubs don't blink out on every add/remove.
    placeholderData: keepPreviousData,
  });
  if (foreign.size === 0) return { data: EMPTY, isPending: false };
  return { data: q.data, isPending: q.isPending };
}
