import { renderHook, act } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE } from "./constants";
import { assertOnline, isOnline, useOnlineStatus } from "./online-status";

describe("assertOnline", () => {
  afterEach(() => onlineManager.setOnline(true));

  it("throws the offline message when offline", () => {
    onlineManager.setOnline(false);
    expect(() => assertOnline()).toThrow(OFFLINE_MESSAGE);
  });

  it("does not throw when online", () => {
    onlineManager.setOnline(true);
    expect(() => assertOnline()).not.toThrow();
  });

  it("isOnline tracks the manager", () => {
    onlineManager.setOnline(false);
    expect(isOnline()).toBe(false);
    onlineManager.setOnline(true);
    expect(isOnline()).toBe(true);
  });
});

describe("useOnlineStatus", () => {
  afterEach(() => onlineManager.setOnline(true));

  it("returns the current connectivity value", () => {
    onlineManager.setOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => onlineManager.setOnline(false));
    expect(result.current).toBe(false);
  });

  it("re-renders with the new value when onlineManager.setOnline flips it", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => onlineManager.setOnline(false));
    expect(result.current).toBe(false);

    act(() => onlineManager.setOnline(true));
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount (no update after unmount)", () => {
    const unsubscribe = vi.fn();
    const subscribeSpy = vi
      .spyOn(onlineManager, "subscribe")
      .mockImplementation(() => unsubscribe);

    const { unmount } = renderHook(() => useOnlineStatus());
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    subscribeSpy.mockRestore();
  });
});
