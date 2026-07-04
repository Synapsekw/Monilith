import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Capture the postgres_changes handlers the hook registers, keyed by table,
// plus the status callback passed to subscribe() so tests can drive reconnects.
const handlers = new Map<string, (p: unknown) => void>();
let statusCb: ((status: string) => void) | undefined;
const channel = {
  on(_event: string, opts: { table: string }, cb: (p: unknown) => void) {
    handlers.set(opts.table, cb);
    return channel;
  },
  subscribe(cb?: (status: string) => void) {
    statusCb = cb;
    return channel;
  },
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => channel,
    removeChannel: vi.fn(),
  }),
}));

import { useBoardRealtime } from "./use-board-realtime";
import { boardKey } from "./use-board-cache";

describe("useBoardRealtime coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    statusCb = undefined;
  });
  afterEach(() => vi.useRealTimers());

  it("applies N synchronous cell events in one setQueryData per frame", () => {
    const qc = new QueryClient();
    qc.setQueryData(boardKey("b1"), {
      board: { id: "b1" },
      groups: [],
      columns: [],
      items: [],
      cellValues: [],
      views: [],
      dependencies: [],
      attachments: [],
      timeEntries: [],
      relationLinks: [],
      mirrorTargetCells: [],
      mirrorTargetColumns: [],
    });
    const setSpy = vi.spyOn(qc, "setQueryData");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const onRemoteChange = vi.fn();
    renderHook(() => useBoardRealtime("b1", { onRemoteChange }), { wrapper });

    const fireCell = handlers.get("cell_values")!;
    act(() => {
      fireCell({
        eventType: "UPDATE",
        new: {
          item_id: "i1",
          column_id: "c1",
          value: { text: "a" },
          board_id: "b1",
        },
        old: {},
      });
      fireCell({
        eventType: "UPDATE",
        new: {
          item_id: "i2",
          column_id: "c1",
          value: { text: "b" },
          board_id: "b1",
        },
        old: {},
      });
    });
    expect(setSpy).not.toHaveBeenCalled(); // buffered, not yet flushed

    act(() => void vi.advanceTimersToNextFrame());
    expect(setSpy).toHaveBeenCalledTimes(1); // single coalesced flush
    const cache = qc.getQueryData(boardKey("b1")) as { cellValues: unknown[] };
    expect(cache.cellValues).toHaveLength(2);
    expect(onRemoteChange).toHaveBeenCalledTimes(2); // one flash per changed cell
  });
});

describe("useBoardRealtime reconnect resync", () => {
  beforeEach(() => {
    handlers.clear();
    statusCb = undefined;
  });

  function mount() {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    renderHook(() => useBoardRealtime("b1"), { wrapper });
    return { invalidateSpy };
  }

  it("does NOT refetch on the first SUBSCRIBED (initial hydration)", () => {
    const { invalidateSpy } = mount();
    act(() => statusCb!("SUBSCRIBED"));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("refetches on a re-SUBSCRIBED after a channel drop", () => {
    const { invalidateSpy } = mount();
    act(() => statusCb!("SUBSCRIBED")); // initial
    act(() => statusCb!("CHANNEL_ERROR")); // laptop sleep / network blip
    act(() => statusCb!("SUBSCRIBED")); // auto-reconnect
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKey("b1") });
  });

  it("refetches after TIMED_OUT and only once per drop", () => {
    const { invalidateSpy } = mount();
    act(() => statusCb!("SUBSCRIBED"));
    act(() => statusCb!("TIMED_OUT"));
    act(() => statusCb!("SUBSCRIBED"));
    act(() => statusCb!("SUBSCRIBED")); // a duplicate SUBSCRIBED must not re-fire
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });
});
