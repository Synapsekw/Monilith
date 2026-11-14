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
          { board_id: "b1", predecessor_board_id: "b1" },
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
          { board_id: "b1", predecessor_board_id: "b2" },
        ]),
      { wrapper: wrap },
    );
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(getBoardDependencyContext).toHaveBeenCalledTimes(1);
    expect(getBoardDependencyContext).toHaveBeenCalledWith({ boardId: "b1" });
    expect(result.current.data).toEqual({ boards: [], items: [] });
  });
});
