import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { getBoardDependencyContext } = vi.hoisted(() => ({
  getBoardDependencyContext: vi.fn(async (_input: { boardId: string }) => ({
    ok: true as const,
    data: { boards: [], items: [] },
  })),
}));
vi.mock("@/lib/boards/dependency-actions", () => ({
  getBoardDependencyContext,
}));
import { useDependencyContext } from "@/lib/boards/use-dependency-context";

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => getBoardDependencyContext.mockClear());

describe("useDependencyContext", () => {
  it("does not fetch when every link is same-board", () => {
    const { result } = renderHook(
      () =>
        useDependencyContext("b1", [
          {
            board_id: "b1",
            predecessor_board_id: "b1",
            predecessor_id: "i0",
            successor_id: "i1",
          },
        ]),
      { wrapper: wrap },
    );
    expect(getBoardDependencyContext).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      data: { boards: [], items: [] },
      isPending: false,
    });
  });

  it("fetches once when a cross-board link exists", async () => {
    const { result } = renderHook(
      () =>
        useDependencyContext("b1", [
          {
            board_id: "b1",
            predecessor_board_id: "b2",
            predecessor_id: "x1",
            successor_id: "i1",
          },
        ]),
      { wrapper: wrap },
    );
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(getBoardDependencyContext).toHaveBeenCalledTimes(1);
    expect(getBoardDependencyContext).toHaveBeenCalledWith({ boardId: "b1" });
    expect(result.current.data).toEqual({ boards: [], items: [] });
  });

  it("refetches when a removed link is replaced by one to a different foreign item", async () => {
    const ctxX = {
      boards: [],
      items: [{ id: "x1" }],
    } as unknown as { boards: []; items: [] };
    const ctxY = {
      boards: [],
      items: [{ id: "y1" }],
    } as unknown as { boards: []; items: [] };
    getBoardDependencyContext
      .mockResolvedValueOnce({ ok: true, data: ctxX })
      .mockResolvedValueOnce({ ok: true, data: ctxY });
    const link = (pred: string) => ({
      board_id: "b1",
      predecessor_board_id: "b2",
      predecessor_id: pred,
      successor_id: "i1",
    });
    const { result, rerender } = renderHook(
      ({ deps }) => useDependencyContext("b1", deps),
      {
        wrapper: wrap,
        initialProps: { deps: [link("x1")] },
      },
    );
    await waitFor(() => expect(result.current.data).toEqual(ctxX));
    rerender({ deps: [] });
    expect(result.current.data).toEqual({ boards: [], items: [] });
    rerender({ deps: [link("y1")] });
    await waitFor(() => expect(result.current.data).toEqual(ctxY));
    expect(getBoardDependencyContext).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous context while a changed key loads", async () => {
    const ctxX = {
      boards: [],
      items: [{ id: "x1" }],
    } as unknown as { boards: []; items: [] };
    let resolveSecond: (v: {
      ok: true;
      data: { boards: []; items: [] };
    }) => void = () => {};
    getBoardDependencyContext
      .mockResolvedValueOnce({ ok: true, data: ctxX })
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveSecond = r;
          }),
      );
    const link = (pred: string) => ({
      board_id: "b1",
      predecessor_board_id: "b2",
      predecessor_id: pred,
      successor_id: "i1",
    });
    const { result, rerender } = renderHook(
      ({ deps }) => useDependencyContext("b1", deps),
      { wrapper: wrap, initialProps: { deps: [link("x1")] } },
    );
    await waitFor(() => expect(result.current.data).toEqual(ctxX));
    rerender({ deps: [link("x1"), link("y1")] });
    await waitFor(() =>
      expect(getBoardDependencyContext).toHaveBeenCalledTimes(2),
    );
    expect(result.current.data).toEqual(ctxX);
    resolveSecond({ ok: true, data: { boards: [], items: [] } });
    await waitFor(() =>
      expect(result.current.data).toEqual({ boards: [], items: [] }),
    );
  });
});
