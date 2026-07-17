import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardFilterSort } from "./use-board-filter-sort";

// useSearchParams reads the app-router context in the hook; mock it so the
// hook can render outside a route. The hook's `write` reads window.location
// directly (jsdom provides it), so the URL assertions still hold.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
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
