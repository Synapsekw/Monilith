import { act, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncExternalStore, type ReactNode } from "react";
import type { BoardCache } from "@/lib/boards/cache";
import { localTodayISO } from "@/lib/boards/overdue";
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
  useBoardIntelligenceOptional,
  useIntelItemIds,
  useIntelMatch,
} from "./context";

// The hook reads the LIVE window.location, and setIntel writes it with the
// History API — exactly how Next syncs useSearchParams() in the app. In
// production, Next 16 patches `window.history.pushState`/`replaceState` to
// notify its search-params store, which is what re-renders every
// `useSearchParams()` consumer after a write (the source's own comment:
// "Next syncs them into useSearchParams()"). This test exercises TWO
// sequential writes in one render session (toggle a chip on, then off) and
// needs to observe both reactively, so the mock reproduces that real
// subscription instead of the "read window.location at render time" stub
// used by single-write tests elsewhere — a plain re-read only works when
// something else already forced a re-render.
const urlStore = vi.hoisted(() => {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot: () => version,
    bump: () => {
      version++;
      for (const l of listeners) l();
    },
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    useSyncExternalStore(urlStore.subscribe, urlStore.getSnapshot);
    return new URLSearchParams(window.location.search);
  },
}));

const originalReplaceState = window.history.replaceState.bind(window.history);
const originalPushState = window.history.pushState.bind(window.history);
window.history.replaceState = ((
  ...args: Parameters<History["replaceState"]>
) => {
  originalReplaceState(...args);
  urlStore.bump();
}) as History["replaceState"];
window.history.pushState = ((...args: Parameters<History["pushState"]>) => {
  originalPushState(...args);
  urlStore.bump();
}) as History["pushState"];

// Fixed clock: the provider's own `now` (`useState(() => new Date())`) reads
// the system clock at mount, and the fixture's item/cell timestamps are fixed
// literals — pinning `Date.now()` here is what keeps "overdue" (yesterday <
// today) true and "stalled" (latest activity < 5 days ago) false regardless of
// the real wall-clock date the suite happens to run on.
const FIXED_NOW = new Date("2026-09-01T12:00:00.000Z");
const yesterday = localTodayISO(new Date(FIXED_NOW.getTime() - 86_400_000));

const cache = {
  board: { id: "b1", org_id: "o1", name: "Board" },
  groups: [
    {
      id: "g1",
      board_id: "b1",
      org_id: "o1",
      name: "G",
      color: "#000",
      position: 0,
    },
  ],
  columns: [
    {
      id: "c-date",
      board_id: "b1",
      org_id: "o1",
      name: "Due",
      kind: "date",
      position: 0,
      settings: {},
      width: null,
    },
  ],
  items: [
    {
      id: "late",
      board_id: "b1",
      org_id: "o1",
      group_id: "g1",
      parent_id: null,
      name: "Late",
      position: 0,
      created_by: "u0",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      archived_at: null,
      archived_by: null,
    },
    {
      id: "fine",
      board_id: "b1",
      org_id: "o1",
      group_id: "g1",
      parent_id: null,
      name: "Fine",
      position: 1,
      created_by: "u0",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      archived_at: null,
      archived_by: null,
    },
  ],
  cellValues: [
    {
      item_id: "late",
      column_id: "c-date",
      value: { date: yesterday },
      updated_at: "2026-09-01T00:00:00Z",
    },
  ],
  dependencies: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
} as unknown as BoardCache;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <BoardIntelligenceProvider
        boardId="b1"
        initialData={cache}
        members={[]}
        lastSeenAt={null}
        currentUserId="u1"
      >
        {children}
      </BoardIntelligenceProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
  window.history.replaceState(null, "", "/boards/b1");
});
afterEach(() => vi.useRealTimers());

describe("BoardIntelligenceProvider", () => {
  it("computes signals from the cache and exposes no active chip by default", () => {
    const { result } = renderHook(() => useBoardIntelligenceOptional(), {
      wrapper,
    });
    expect(result.current?.signals.map((s) => s.kind)).toEqual(["overdue"]);
    expect(result.current?.activeSignal).toBeNull();
    expect(result.current?.intelItemIds).toBeNull();
    expect(result.current?.lastChangeAt).toBe("2026-09-01T00:00:00.000Z");
    expect(result.current?.loading).toBe(false);
  });

  it("toggle activates a chip (URL intel=…), toggling again clears it", () => {
    const { result } = renderHook(
      () => ({
        intel: useBoardIntelligenceOptional(),
        ids: useIntelItemIds(),
        late: useIntelMatch("late"),
        fine: useIntelMatch("fine"),
      }),
      { wrapper },
    );
    const overdue = result.current.intel!.signals[0];
    act(() => result.current.intel!.toggle(overdue));
    expect(window.location.search).toContain("intel=overdue");
    expect(result.current.intel!.activeSignal?.kind).toBe("overdue");
    expect([...result.current.ids!]).toEqual(["late"]);
    expect(result.current.late).toBe(true);
    expect(result.current.fine).toBe(false);

    act(() => result.current.intel!.toggle(overdue));
    expect(window.location.search).not.toContain("intel=");
    expect(result.current.late).toBeNull();
  });

  it("clear removes the chip; a stale URL chip with no matching signal narrows nothing", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=blocked");
    const { result } = renderHook(() => useBoardIntelligenceOptional(), {
      wrapper,
    });
    expect(result.current?.selection).toEqual({ kind: "blocked" });
    expect(result.current?.activeSignal).toBeNull();
    expect(result.current?.intelItemIds).toBeNull();
    act(() => result.current!.clear());
    expect(result.current?.selection).toBeNull();
  });

  it("IntelToneFrame stamps the active tone for the CSS rule", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=overdue");
    render(
      <IntelToneFrame>
        <span>row</span>
      </IntelToneFrame>,
      { wrapper },
    );
    expect(screen.getByText("row").parentElement).toHaveAttribute(
      "data-intel-tone",
      "red",
    );
  });

  it("hooks fail open without a provider", () => {
    const { result } = renderHook(() => ({
      intel: useBoardIntelligenceOptional(),
      ids: useIntelItemIds(),
      m: useIntelMatch("x"),
    }));
    expect(result.current).toEqual({ intel: null, ids: null, m: null });
  });
});
