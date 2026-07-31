import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const trackMock = vi.fn();
const onMock = vi.fn().mockReturnThis();
const subscribeMock = vi.fn();
const presenceStateMock = vi.fn().mockReturnValue({});

vi.mock("./presence-channel", () => ({
  boardPresenceTopic: (id: string) => `presence:board:${id}`,
  createBoardPresenceChannel: vi.fn(async () => ({
    on: onMock,
    subscribe: subscribeMock,
    track: trackMock,
    untrack: vi.fn(),
    presenceState: presenceStateMock,
    unsubscribe: vi.fn(),
  })),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useBoardPresence } from "./use-board-presence";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useBoardPresence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks the local presence state on subscribe", async () => {
    renderHook(
      () =>
        useBoardPresence("board-1", {
          userId: "u1",
          name: "Dani",
          avatarUrl: null,
        }),
      { wrapper },
    );
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    const cb = subscribeMock.mock.calls[0][0];
    act(() => cb("SUBSCRIBED"));
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", focus: null }),
    );
  });

  it("setFocus re-tracks with the new focus (throttled)", async () => {
    const { result } = renderHook(
      () =>
        useBoardPresence("board-1", {
          userId: "u1",
          name: "Dani",
          avatarUrl: null,
        }),
      { wrapper },
    );
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    act(() => subscribeMock.mock.calls[0][0]("SUBSCRIBED"));
    act(() =>
      result.current.setFocus({ viewKind: "table", targetId: "cell:i1:c1" }),
    );
    await waitFor(() =>
      expect(trackMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          focus: { viewKind: "table", targetId: "cell:i1:c1" },
        }),
      ),
    );
  });
});
