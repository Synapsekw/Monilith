"use client";
import { useQuery } from "@tanstack/react-query";
import { getBoardDependencyContext } from "@/lib/boards/dependency-actions";
import type { DependencyContext } from "@/lib/boards/timeline-context";

const EMPTY: DependencyContext = { boards: [], items: [] };

export const dependencyContextKey = (boardId: string) =>
  ["board-dep-context", boardId] as const;

/** Foreign ends of this board's cross-board links. No request for same-board-only boards. */
export function useDependencyContext(
  boardId: string,
  dependencies: readonly { board_id: string; predecessor_board_id: string }[],
): { data: DependencyContext | undefined; isPending: boolean } {
  // crossCount is part of the key so adding/removing a cross-board link (via
  // realtime) refetches the context — one request per change, and only on
  // boards that actually have such links.
  const crossCount = dependencies.filter(
    (d) => d.board_id !== d.predecessor_board_id,
  ).length;
  const q = useQuery({
    queryKey: [...dependencyContextKey(boardId), crossCount],
    queryFn: async () => {
      const res = await getBoardDependencyContext({ boardId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: crossCount > 0,
    staleTime: 60_000,
  });
  if (crossCount === 0) return { data: EMPTY, isPending: false };
  return { data: q.data, isPending: q.isPending };
}
