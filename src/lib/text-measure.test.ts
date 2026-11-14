import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMeasureFont, createTextMeasurer } from "@/lib/text-measure";

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
