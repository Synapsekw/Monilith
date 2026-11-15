import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useFontsReady } from "./use-fonts-ready";

const original = Object.getOwnPropertyDescriptor(document, "fonts");
afterEach(() => {
  if (original) Object.defineProperty(document, "fonts", original);
  else delete (document as unknown as Record<string, unknown>).fonts;
});
function setFonts(value: unknown) {
  Object.defineProperty(document, "fonts", { configurable: true, value });
}

describe("useFontsReady", () => {
  it("is true right after mount when document.fonts is missing", () => {
    setFonts(undefined);
    const { result } = renderHook(() => useFontsReady());
    expect(result.current).toBe(true);
  });

  it("is true right after mount when fonts are already loaded", () => {
    setFonts({ status: "loaded", ready: Promise.resolve() });
    const { result } = renderHook(() => useFontsReady());
    expect(result.current).toBe(true);
  });

  it("stays false while fonts are loading, then flips once they resolve", async () => {
    let resolve!: () => void;
    setFonts({
      status: "loading",
      ready: new Promise<void>((r) => (resolve = r)),
    });
    const { result } = renderHook(() => useFontsReady());
    expect(result.current).toBe(false);
    await act(async () => {
      resolve();
    });
    expect(result.current).toBe(true);
  });

  it("does not set state after unmount", async () => {
    let resolve!: () => void;
    setFonts({
      status: "loading",
      ready: new Promise<void>((r) => (resolve = r)),
    });
    const { unmount } = renderHook(() => useFontsReady());
    unmount();
    await act(async () => {
      resolve();
    });
  });
});
