import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useCoarsePointer } from "./use-coarse-pointer";

type Listener = (e: { matches: boolean }) => void;

/** Replace window.matchMedia with a controllable coarse/fine pointer mock. */
function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return matches;
    },
    media: "(pointer: coarse)",
    onchange: null,
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
    addListener: (cb: Listener) => listeners.add(cb),
    removeListener: (cb: Listener) => listeners.delete(cb),
    dispatchEvent: () => false,
  };
  window.matchMedia = vi
    .fn()
    .mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb({ matches: next }));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("returns true when the pointer is coarse (touch)", () => {
  mockMatchMedia(true);
  const { result } = renderHook(() => useCoarsePointer());
  expect(result.current).toBe(true);
});

test("returns false when the pointer is fine (mouse/trackpad)", () => {
  mockMatchMedia(false);
  const { result } = renderHook(() => useCoarsePointer());
  expect(result.current).toBe(false);
});

test("reacts when the active pointer changes", () => {
  const mm = mockMatchMedia(false);
  const { result } = renderHook(() => useCoarsePointer());
  expect(result.current).toBe(false);
  act(() => {
    mm.set(true);
  });
  expect(result.current).toBe(true);
});
