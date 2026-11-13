import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRafCallback, useRafThrottle } from "./use-raf-callback";

describe("useRafCallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces multiple calls in a frame to one call with latest args", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useRafCallback(fn));
    act(() => {
      result.current(1);
      result.current(2);
    });
    expect(fn).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersToNextFrame());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });

  it("does not fire after unmount", () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useRafCallback(fn));
    act(() => result.current(1));
    unmount();
    act(() => void vi.advanceTimersToNextFrame());
    expect(fn).not.toHaveBeenCalled();
  });

  it("cancel() drops the pending frame and the next call schedules afresh", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useRafThrottle(fn));
    act(() => {
      result.current[0](1);
      result.current[1]();
    });
    act(() => void vi.advanceTimersToNextFrame());
    expect(fn).not.toHaveBeenCalled();
    act(() => result.current[0](3));
    act(() => void vi.advanceTimersToNextFrame());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });
});
