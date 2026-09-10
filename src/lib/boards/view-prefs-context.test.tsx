import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoardViewPrefsProvider,
  useBoardViewPrefs,
} from "./view-prefs-context";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";

const save = vi.fn(async () => ({ ok: true as const, data: undefined }));
vi.mock("./view-prefs-actions", () => ({
  saveBoardViewPrefs: (...args: unknown[]) => save(...(args as [])),
}));

const BOARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_A = "11111111-1111-4111-8111-111111111111";
const GROUP_B = "22222222-2222-4222-8222-222222222222";
const ITEM_A = "33333333-3333-4333-8333-333333333333";

function wrapper(initial = EMPTY_BOARD_VIEW_PREFS) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <BoardViewPrefsProvider boardId={BOARD} initial={initial}>
        {children}
      </BoardViewPrefsProvider>
    );
  };
}

describe("BoardViewPrefsProvider", () => {
  beforeEach(() => {
    save.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("seeds its sets from the initial state", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper({
        ...EMPTY_BOARD_VIEW_PREFS,
        collapsedGroupIds: [GROUP_A],
        filterQuery: "q=hi",
      }),
    });
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(true);
    expect(result.current.initialFilterQuery).toBe("q=hi");
  });

  it("toggles a group and persists once after the debounce", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper(),
    });

    act(() => {
      result.current.toggleGroupCollapsed(GROUP_A);
      result.current.toggleGroupCollapsed(GROUP_B);
    });
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(true);
    expect(save).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      boardId: BOARD,
      state: {
        viewId: null,
        collapsedGroupIds: [GROUP_A, GROUP_B],
        expandedItemIds: [],
        filterQuery: "",
      },
    });
  });

  it("toggling a group twice returns it to expanded", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper(),
    });
    act(() => {
      result.current.toggleGroupCollapsed(GROUP_A);
    });
    act(() => {
      result.current.toggleGroupCollapsed(GROUP_A);
    });
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(false);
  });

  it("prunes ids that no longer exist on the board", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper({
        ...EMPTY_BOARD_VIEW_PREFS,
        collapsedGroupIds: [GROUP_A, GROUP_B],
        expandedItemIds: [ITEM_A],
      }),
    });

    act(() => {
      result.current.pruneTo({ groupIds: [GROUP_A], itemIds: [] });
    });
    expect(result.current.collapsedGroups.has(GROUP_B)).toBe(false);
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(true);
    expect(result.current.expandedItems.size).toBe(0);
  });

  it("does not persist when pruning changes nothing", () => {
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper({
        ...EMPTY_BOARD_VIEW_PREFS,
        collapsedGroupIds: [GROUP_A],
      }),
    });
    act(() => {
      result.current.pruneTo({ groupIds: [GROUP_A], itemIds: [] });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("a failed save never throws", async () => {
    save.mockResolvedValueOnce({ ok: false, error: "nope" } as never);
    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: wrapper(),
    });
    act(() => {
      result.current.toggleGroupCollapsed(GROUP_A);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(true);
  });

  // A board must render even when the arrangement it was handed is missing or
  // half-shaped. Reading a field straight off the prop threw here and took the
  // whole board down with it, which is the opposite of what this provider
  // promises. The casts are the point: they stand in for a caller the compiler
  // never saw — a stale bundle mid-HMR, or a payload from an older client.
  it("renders with defaults when handed no arrangement at all", () => {
    const NoInitial = ({ children }: { children: React.ReactNode }) => (
      <BoardViewPrefsProvider
        boardId={BOARD}
        initial={undefined as unknown as typeof EMPTY_BOARD_VIEW_PREFS}
      >
        {children}
      </BoardViewPrefsProvider>
    );

    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: NoInitial,
    });
    expect(result.current.collapsedGroups.size).toBe(0);
    expect(result.current.expandedItems.size).toBe(0);
    expect(result.current.initialFilterQuery).toBe("");
  });

  it("fills the gaps when handed a partial arrangement", () => {
    const Partial = ({ children }: { children: React.ReactNode }) => (
      <BoardViewPrefsProvider
        boardId={BOARD}
        initial={
          {
            collapsedGroupIds: [GROUP_A],
          } as unknown as typeof EMPTY_BOARD_VIEW_PREFS
        }
      >
        {children}
      </BoardViewPrefsProvider>
    );

    const { result } = renderHook(() => useBoardViewPrefs(), {
      wrapper: Partial,
    });
    expect(result.current.collapsedGroups.has(GROUP_A)).toBe(true);
    expect(result.current.expandedItems.size).toBe(0);
    expect(result.current.initialFilterQuery).toBe("");
  });
});
