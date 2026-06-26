import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRafCallback } from "./use-raf-callback";

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
});
