import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  buildMeasureFont,
  createTextMeasurer,
  useTextMeasurer,
} from "@/lib/text-measure";

afterEach(() => vi.restoreAllMocks());

describe("buildMeasureFont", () => {
  it("uses the live font family when the variable is set", () => {
    expect(buildMeasureFont("'__Inter_1a2b3c'", "500", "11px")).toBe(
      "500 11px '__Inter_1a2b3c', ui-sans-serif, system-ui, sans-serif",
    );
  });
  it("falls back to the Inter literal when the variable is empty", () => {
    expect(buildMeasureFont("  ", "500", "13.5px")).toBe(
      "500 13.5px Inter, ui-sans-serif, system-ui, sans-serif",
    );
  });
});

describe("createTextMeasurer", () => {
  it("measures 0 where there is no canvas", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(createTextMeasurer("500", "11px")("abc")).toBe(0);
  });
  it("measures through the canvas context at the requested font", () => {
    const ctx = {
      font: "",
      measureText: (t: string) => ({ width: t.length * 7 }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as never,
    );
    const measure = createTextMeasurer("500", "11px");
    expect(measure("abcd")).toBe(28);
    expect(ctx.font).toBe(
      "500 11px Inter, ui-sans-serif, system-ui, sans-serif",
    );
  });
});

describe("useTextMeasurer", () => {
  function fakeFonts(status: "loading" | "loaded") {
    const target = new EventTarget();
    let resolve!: () => void;
    const ready = new Promise<void>((r) => (resolve = r));
    const fonts = Object.assign(target, { status, ready });
    Object.defineProperty(document, "fonts", {
      value: fonts,
      configurable: true,
    });
    return { target, resolve };
  }
  afterEach(() => {
    delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it("keeps the same measurer when nothing loads", () => {
    fakeFonts("loaded");
    const { result, rerender } = renderHook(() =>
      useTextMeasurer("500", "11px"),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("returns a fresh measurer (empty cache) after loadingdone", () => {
    const { target } = fakeFonts("loaded");
    const measureText = vi.fn((t: string) => ({ width: t.length }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText,
    } as never);
    const { result } = renderHook(() => useTextMeasurer("500", "11px"));
    const first = result.current;
    first("abc");
    first("abc");
    expect(measureText).toHaveBeenCalledTimes(1); // cached
    act(() => {
      target.dispatchEvent(new Event("loadingdone"));
    });
    expect(result.current).not.toBe(first);
    result.current("abc");
    expect(measureText).toHaveBeenCalledTimes(2); // re-measured
  });

  it("re-creates once fonts.ready resolves after mount", async () => {
    const { resolve } = fakeFonts("loading");
    const { result } = renderHook(() => useTextMeasurer("500", "11px"));
    const first = result.current;
    await act(async () => {
      resolve();
    });
    expect(result.current).not.toBe(first);
  });

  it("works where document.fonts does not exist", () => {
    const { result } = renderHook(() => useTextMeasurer("500", "11px"));
    expect(result.current("abc")).toBe(0);
  });
});
