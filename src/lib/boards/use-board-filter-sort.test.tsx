import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardFilterSort } from "./use-board-filter-sort";
import { BoardViewPrefsProvider } from "@/lib/boards/view-prefs-context";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";

// useSearchParams reads the app-router context in the hook; mock it so the
// hook can render outside a route. It reads the LIVE `window.location` so a
// History-API write (which is how this hook publishes state) is visible to the
// next render, exactly as Next syncs it in the app.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// The provider persists through a real Server Action, which cannot run in
// jsdom.
vi.mock("@/lib/boards/view-prefs-actions", () => ({
  saveBoardViewPrefs: vi.fn(async () => ({ ok: true, data: undefined })),
}));

describe("useBoardFilterSort search debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => vi.useRealTimers());

  it("writes the q param only once after typing settles", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useBoardFilterSort());

    act(() => {
      result.current.setSearch("r");
      result.current.setSearch("re");
      result.current.setSearch("rep");
    });
    expect(spy).not.toHaveBeenCalled(); // debounced — nothing written yet

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][2])).toContain("q=rep");
    spy.mockRestore();
  });

  it("clears the q param immediately (X button — not debounced)", () => {
    // Seed a non-empty q so clearing has something to remove.
    window.history.replaceState(null, "", "/?q=rep");
    const spy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useBoardFilterSort());

    act(() => {
      result.current.setSearch("");
    });
    // Applied synchronously — no timer advance needed.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][2])).not.toContain("q=");
    spy.mockRestore();
  });
});

describe("useBoardFilterSort saved-filter seeding", () => {
  const BOARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function wrapWithPrefs(filterQuery: string) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <BoardViewPrefsProvider
          boardId={BOARD}
          initial={{ ...EMPTY_BOARD_VIEW_PREFS, filterQuery }}
        >
          {children}
        </BoardViewPrefsProvider>
      );
    };
  }

  beforeEach(() => {
    window.history.replaceState(null, "", "/boards/x");
  });

  it("seeds state from the saved filter when the URL carries none", () => {
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: wrapWithPrefs("q=hello"),
    });
    expect(result.current.state.q).toBe("hello");
    expect(result.current.isActive).toBe(true);
  });

  it("writes the saved filter into the URL on mount", () => {
    renderHook(() => useBoardFilterSort(), {
      wrapper: wrapWithPrefs("q=hello"),
    });
    expect(window.location.search).toContain("q=hello");
  });

  it("does not resurrect the saved filter after clearAll", () => {
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: wrapWithPrefs("q=hello"),
    });
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.state.q).toBe("");
  });

  it("leaves the URL filter alone when one is present", () => {
    // The mocked useSearchParams returns the URL's params for this case.
    window.history.replaceState(null, "", "/boards/x?q=fromurl");
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: wrapWithPrefs("q=saved"),
    });
    expect(result.current.state.q).not.toBe("saved");
  });
});
