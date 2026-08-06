import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import {
  boardSnapshotKey,
  useBoardSnapshot,
  type BoardSnapshot,
} from "./snapshot";

const payload = { board: { id: "b1", org_id: "o1" }, views: [{ id: "v1" }] };

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("useBoardSnapshot", () => {
  it("writes the render props under the board snapshot key", () => {
    const qc = new QueryClient();
    renderHook(
      () =>
        useBoardSnapshot({
          payload: payload as never,
          members: [],
          initialViewId: "v1",
          currentUserId: "u1",
        }),
      { wrapper: wrapper(qc) },
    );

    const stored = qc.getQueryData<BoardSnapshot>(boardSnapshotKey("b1"));
    expect(stored?.initialViewId).toBe("v1");
    expect(stored?.currentUserId).toBe("u1");
    expect(stored?.payload.views).toHaveLength(1);
    expect(typeof stored?.savedAt).toBe("number");
  });
});
