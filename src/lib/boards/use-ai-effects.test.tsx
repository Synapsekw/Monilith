import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useApplyBoardEffects } from "./use-ai-effects";
import { boardKey } from "./use-board-cache";
import type { BoardCache } from "./cache";
import type { BoardEffect } from "@/lib/ai/write/effects";

function seededClient(): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData<BoardCache>(boardKey("b1"), {
    board: { id: "b1", org_id: "o1", name: "B" } as BoardCache["board"],
    groups: [],
    columns: [],
    items: [],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  });
  return qc;
}

function wrapper(qc: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = "TestWrapper";
  return Wrapper;
}

const created: BoardEffect = {
  kind: "item_created",
  boardId: "b1",
  item: { id: "i9", board_id: "b1", group_id: "g1", parent_id: null } as never,
  cells: [],
};

describe("useApplyBoardEffects", () => {
  it("patches the board cache for the effect's board", () => {
    const qc = seededClient();
    const { result } = renderHook(() => useApplyBoardEffects(), {
      wrapper: wrapper(qc),
    });
    act(() => result.current([created]));
    expect(
      qc.getQueryData<BoardCache>(boardKey("b1"))?.items.map((i) => i.id),
    ).toEqual(["i9"]);
  });

  it("no-ops when the effect targets a board with no mounted cache", () => {
    const qc = seededClient();
    const { result } = renderHook(() => useApplyBoardEffects(), {
      wrapper: wrapper(qc),
    });
    act(() => result.current([{ ...created, boardId: "b-other" }]));
    expect(qc.getQueryData<BoardCache>(boardKey("b-other"))).toBeUndefined();
    expect(qc.getQueryData<BoardCache>(boardKey("b1"))?.items).toHaveLength(0);
  });

  it("applies several effects in order", () => {
    const qc = seededClient();
    const { result } = renderHook(() => useApplyBoardEffects(), {
      wrapper: wrapper(qc),
    });
    act(() =>
      result.current([
        created,
        {
          kind: "group_created",
          boardId: "b1",
          group: { id: "g2", board_id: "b1", position: 1 } as never,
        },
      ]),
    );
    const cache = qc.getQueryData<BoardCache>(boardKey("b1"));
    expect(cache?.items).toHaveLength(1);
    expect(cache?.groups).toHaveLength(1);
  });

  it("an empty effect list changes nothing", () => {
    // The cancel path calls this with []; it must not touch the cache.
    const qc = seededClient();
    const before = qc.getQueryData<BoardCache>(boardKey("b1"));
    const { result } = renderHook(() => useApplyBoardEffects(), {
      wrapper: wrapper(qc),
    });
    act(() => result.current([]));
    expect(qc.getQueryData<BoardCache>(boardKey("b1"))).toBe(before);
  });
});
