import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-query-persist-client", () => ({
  persistQueryClientRestore: vi.fn(),
}));

// The grace check gates the restore (B4), so it has to be controllable here.
const enforceOfflineGrace = vi.fn();
vi.mock("@/lib/offline/entitlement", () => ({
  enforceOfflineGrace: (...args: unknown[]) => enforceOfflineGrace(...args),
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
import { persistQueryClientRestore } from "@tanstack/react-query-persist-client";

const restoreMock = vi.mocked(persistQueryClientRestore);

function wrap(qc: QueryClient) {
  // Named function expression (not an anonymous arrow) so eslint's
  // react/display-name has a name to infer — same idiom as `Wrapper` in
  // snapshot.test.tsx.
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  // Default: restore resolves immediately. Individual tests override this to
  // exercise the pending and rejected paths.
  restoreMock.mockReset();
  restoreMock.mockResolvedValue(undefined);
  enforceOfflineGrace.mockReset();
  enforceOfflineGrace.mockResolvedValue(true);
});

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

  it("logs a warning and still falls back (not crashes) when restore rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    restoreMock.mockRejectedValue(new Error("idb-keyval unavailable"));

    const qc = new QueryClient();
    render(<OfflineBoard boardId="never-opened" userId="u1" />, {
      wrapper: wrap(qc),
    });

    // Same fallback copy as the never-cached case — a rejected restore is not
    // distinguishable to the user, but it must not crash and must leave a
    // diagnostic trail (the console.warn below) rather than failing silently.
    expect(
      await screen.findByText(/isn't available offline/i),
    ).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/failed to restore/i);

    warn.mockRestore();
  });

  it("shows a loading skeleton until restore settles, then replaces it", async () => {
    let resolveRestore: () => void = () => undefined;
    restoreMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRestore = resolve;
      }),
    );

    const qc = new QueryClient();
    render(<OfflineBoard boardId="never-opened" userId="u1" />, {
      wrapper: wrap(qc),
    });

    // Restore is still pending: the busy skeleton is showing, not the
    // fallback copy or the board.
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByText(/isn't available offline/i),
    ).not.toBeInTheDocument();

    resolveRestore();

    // The skeleton (the only `role="status"` element while online, since
    // OfflineBanner renders nothing when online) is gone once restore settles.
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(
      await screen.findByText(/isn't available offline/i),
    ).toBeInTheDocument();
  });
});

describe("OfflineBoard entitlement grace (B4)", () => {
  it("refuses to restore or render when the grace has lapsed", async () => {
    // `enforceOfflineGrace` returning false means it has already wiped the
    // cached data. Restoring anyway would render boards the user is no longer
    // entitled to, and wiping only for "next time" is not enforcement.
    enforceOfflineGrace.mockResolvedValue(false);
    const qc = new QueryClient();
    qc.setQueryData(boardSnapshotKey("b1"), {
      payload: { board: { id: "b1", org_id: "o1" }, views: [{ id: "v1" }] },
      members: [],
      initialViewId: "v1",
      currentUserId: "u1",
      savedAt: Date.now(),
    });

    render(<OfflineBoard boardId="b1" userId="u1" />, { wrapper: wrap(qc) });

    expect(
      await screen.findByText(/offline access has expired/i),
    ).toBeInTheDocument();
    expect(restoreMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("board-views")).not.toBeInTheDocument();
  });

  it("runs the grace check BEFORE restoring, not after", async () => {
    const order: string[] = [];
    enforceOfflineGrace.mockImplementation(() => {
      order.push("grace");
      return Promise.resolve(true);
    });
    restoreMock.mockImplementation(() => {
      order.push("restore");
      return Promise.resolve(undefined);
    });

    render(<OfflineBoard boardId="b1" userId="u1" />, {
      wrapper: wrap(new QueryClient()),
    });

    await waitFor(() => expect(order).toEqual(["grace", "restore"]));
  });

  it("fails closed if the grace check itself rejects", async () => {
    // Unreachable today (enforceOfflineGrace swallows its own errors), but an
    // unhandled rejection would otherwise strand the page on the skeleton.
    enforceOfflineGrace.mockRejectedValue(new Error("boom"));
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<OfflineBoard boardId="b1" userId="u1" />, {
      wrapper: wrap(new QueryClient()),
    });

    expect(
      await screen.findByText(/offline access has expired/i),
    ).toBeInTheDocument();
    expect(restoreMock).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
