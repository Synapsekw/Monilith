import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedCallback } from "./use-debounced-callback";

describe("useDebouncedCallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once after the quiet period with the latest args", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 200));
    act(() => {
      result.current(1);
      result.current(2);
      result.current(3);
    });
    expect(fn).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(200));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it("does not fire after unmount", () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 200));
    act(() => result.current());
    unmount();
    act(() => void vi.advanceTimersByTime(500));
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps a stable identity across renders", () => {
    const fn = vi.fn();
    const { result, rerender } = renderHook(() =>
      useDebouncedCallback(fn, 200),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("cancel() discards the pending invocation but not future ones", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 200));
    act(() => result.current("stale"));
    act(() => result.current.cancel());
    act(() => void vi.advanceTimersByTime(500));
    expect(fn).not.toHaveBeenCalled();

    // The debounced callback still works after a cancel.
    act(() => result.current("fresh"));
    act(() => void vi.advanceTimersByTime(200));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("fresh");
  });
});
