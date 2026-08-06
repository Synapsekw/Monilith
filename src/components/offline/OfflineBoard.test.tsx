import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-query-persist-client", () => ({
  persistQueryClientRestore: vi.fn().mockResolvedValue(undefined),
}));

const boardViewsProps = vi.fn();
vi.mock("@/components/boards/BoardViews", () => ({
  // Named function expression (not an anonymous arrow) so eslint's
  // react/display-name has a name to infer — same idiom as the `Lazy` mock in
  // BoardViews.test.tsx.
  BoardViews: function BoardViews(props: Record<string, unknown>) {
    boardViewsProps(props);
    return <div data-testid="board-views" />;
  },
}));

import { OfflineBoard } from "./OfflineBoard";
import { boardSnapshotKey } from "@/lib/offline/snapshot";

function wrap(qc: QueryClient) {
  // Named function expression (not an anonymous arrow) so eslint's
  // react/display-name has a name to infer — same idiom as `Wrapper` in
  // snapshot.test.tsx.
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("OfflineBoard", () => {
  it("renders a cached board as a viewer", async () => {
    const qc = new QueryClient();
    qc.setQueryData(boardSnapshotKey("b1"), {
      payload: { board: { id: "b1", org_id: "o1" }, views: [{ id: "v1" }] },
      members: [],
      initialViewId: "v1",
      currentUserId: "u1",
      savedAt: Date.now(),
    });

    render(<OfflineBoard boardId="b1" userId="u1" />, { wrapper: wrap(qc) });

    expect(await screen.findByTestId("board-views")).toBeInTheDocument();
    // Read-only is not a new mode — it is the board's existing viewer access.
    expect(boardViewsProps).toHaveBeenCalledWith(
      expect.objectContaining({ access: "viewer" }),
    );
  });

  it("says so when the board was never cached", async () => {
    const qc = new QueryClient();
    render(<OfflineBoard boardId="never-opened" userId="u1" />, {
      wrapper: wrap(qc),
    });
    expect(
      await screen.findByText(/isn't available offline/i),
    ).toBeInTheDocument();
  });
});
