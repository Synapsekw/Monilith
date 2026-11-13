import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { boardKey } from "./use-board-cache";
import { useResyncBoards } from "./use-resync-boards";

describe("useResyncBoards", () => {
  it("invalidates the cache of each touched board, once per board", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useResyncBoards(), { wrapper });
    result.current(["b-1", "b-2", "b-1"]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: boardKey("b-1") });
    expect(spy).toHaveBeenCalledWith({ queryKey: boardKey("b-2") });
  });
});
