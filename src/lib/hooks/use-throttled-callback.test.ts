import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottledCallback } from "./use-throttled-callback";

describe("useThrottledCallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces calls in the window into one trailing flush with latest args", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(fn, 150));
    act(() => {
      result.current("a");
      result.current("b");
    });
    expect(fn).not.toHaveBeenCalled(); // trailing-only: nothing fires immediately
    act(() => void vi.advanceTimersByTime(150));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");
  });

  it("opens a fresh window after a flush", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(fn, 150));
    act(() => result.current("a"));
    act(() => void vi.advanceTimersByTime(150));
    act(() => result.current("c"));
    act(() => void vi.advanceTimersByTime(150));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("c");
  });

  it("does not fire after unmount", () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useThrottledCallback(fn, 150));
    act(() => result.current("x"));
    unmount();
    act(() => void vi.advanceTimersByTime(500));
    expect(fn).not.toHaveBeenCalled();
  });
});
