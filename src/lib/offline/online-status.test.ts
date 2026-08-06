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

describe("cold-start connectivity (page loaded while already offline)", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    window.navigator,
    "onLine",
  );

  function setNavigatorOnLine(value: boolean) {
    Object.defineProperty(window.navigator, "onLine", {
      value,
      configurable: true,
    });
  }

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(window.navigator, "onLine", originalDescriptor);
    }
    onlineManager.setOnline(true);
  });

  it("seeds onlineManager from navigator.onLine at module load", async () => {
    // TanStack's OnlineManager starts at `true` and only changes on the
    // online/offline EVENTS, which fire on a TRANSITION. A page loaded while
    // already offline never receives one, so without the module-load seed in
    // online-status.ts it reports ONLINE while genuinely offline — which
    // silently disabled the offline banner AND assertOnline() on /offline, the
    // one page whose entire purpose is being offline.
    setNavigatorOnLine(false);
    onlineManager.setOnline(true); // the manager's own wrong default

    vi.resetModules();
    const reimported = await import("./online-status");

    expect(onlineManager.isOnline()).toBe(false);
    expect(reimported.isOnline()).toBe(false);
    expect(() => reimported.assertOnline()).toThrow(OFFLINE_MESSAGE);
  });

  it("seeds as online when navigator reports online", async () => {
    setNavigatorOnLine(true);
    onlineManager.setOnline(false);

    vi.resetModules();
    const reimported = await import("./online-status");

    expect(onlineManager.isOnline()).toBe(true);
    expect(() => reimported.assertOnline()).not.toThrow();
  });

  it("leaves setOnline authoritative afterwards (no re-seed on re-render)", () => {
    // Guards the alternative implementation that replaced
    // onlineManager.setEventListener: the manager re-runs its setup on every
    // re-subscribe, and useOnlineStatus passes a fresh closure each render, so
    // that version re-seeded from navigator.onLine on every re-render and
    // clobbered explicit setOnline calls.
    setNavigatorOnLine(true);
    const { result, rerender } = renderHook(() => useOnlineStatus());

    act(() => onlineManager.setOnline(false));
    rerender();

    expect(result.current).toBe(false);
    expect(onlineManager.isOnline()).toBe(false);
  });
});
