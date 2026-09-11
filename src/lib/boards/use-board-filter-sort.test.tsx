import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardFilterSort } from "./use-board-filter-sort";
import { BoardViewPrefsProvider } from "@/lib/boards/view-prefs-context";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";
import { saveBoardViewPrefs } from "@/lib/boards/view-prefs-actions";
import { SAVE_DEBOUNCE_MS } from "@/lib/boards/view-prefs-context";

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

  it("keeps an ?intel=-only URL AND the saved filter, and never erases the save", () => {
    // `intel` is a lens, not an arrangement: a shared `?intel=overdue` link
    // carries no filter param, so the saved filter must still seed — and the
    // chip must survive that seeding. The regression: `intel` counted as "the
    // URL has a filter", so the save was neither applied nor seeded, and the
    // next write persisted the resulting empty filter over it.
    window.history.replaceState(null, "", "/boards/x?intel=overdue");
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: wrapWithPrefs("q=urgent"),
    });
    expect(result.current.state.q).toBe("urgent");
    expect(result.current.state.intel).toEqual({ kind: "overdue" });

    act(() => result.current.setIntel(null));
    expect(window.location.search).not.toContain("intel=");
    // The saved arrangement survived the write, in the URL…
    expect(window.location.search).toContain("q=urgent");
    expect(result.current.state.q).toBe("urgent");
    // …and in what was persisted: every save (if any fired at all) carries the
    // saved filter unchanged, never the empty string.
    for (const [arg] of vi.mocked(saveBoardViewPrefs).mock.calls) {
      expect(arg.state.filterQuery).toBe("q=urgent");
    }
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

describe("useBoardFilterSort intel chip", () => {
  const BOARD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <BoardViewPrefsProvider boardId={BOARD} initial={EMPTY_BOARD_VIEW_PREFS}>
        {children}
      </BoardViewPrefsProvider>
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/boards/x?view=v1");
    vi.mocked(saveBoardViewPrefs).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("setIntel writes intel=<kind:subject> with replaceState and keeps ?view=", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: Wrapper,
    });
    act(() => result.current.setIntel({ kind: "overloaded", subject: "u1" }));
    expect(spy).toHaveBeenCalledTimes(1);
    const url = String(spy.mock.calls[0][2]);
    expect(url).toContain("intel=overloaded%3Au1");
    expect(url).toContain("view=v1");
    expect(result.current.state.intel).toEqual({
      kind: "overloaded",
      subject: "u1",
    });
    spy.mockRestore();
  });

  it("setIntel(null) removes the param; clearAll removes it too", () => {
    window.history.replaceState(null, "", "/boards/x?intel=overdue&q=x");
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: Wrapper,
    });
    expect(result.current.state.intel).toEqual({ kind: "overdue" });
    act(() => result.current.setIntel(null));
    expect(window.location.search).not.toContain("intel=");
    expect(window.location.search).toContain("q=x");

    act(() => result.current.setIntel({ kind: "overdue" }));
    act(() => result.current.clearAll());
    expect(window.location.search).not.toContain("intel=");
    expect(result.current.state.intel).toBeNull();
  });

  it("never persists the chip into the saved filter query", () => {
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: Wrapper,
    });
    act(() => result.current.setIntel({ kind: "overdue" }));
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 100);
    });
    // The persisted filter query is unchanged ("" → ""), so the debounced
    // save never fires — proof that intel is not part of what is remembered.
    expect(saveBoardViewPrefs).not.toHaveBeenCalled();
  });
});
