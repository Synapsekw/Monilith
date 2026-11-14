import fs from "node:fs";
import path from "node:path";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIT_FONT_SIZES,
  buildFitFonts,
  useColumnAutoFit,
} from "./use-column-auto-fit";

// jsdom has no canvas: give the hook a context that measures 7px per character
// in every font.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const columns = [
  { id: "c1", kind: "text", name: "Notes", settings: {}, width: null },
  { id: "c2", kind: "text", name: "Saved", settings: {}, width: 240 },
];
const cell = (text: string) => ({ column_id: "c1", value: { text } });

type Props = Parameters<typeof useColumnAutoFit>[0];
const base: Props = {
  columns,
  cellValues: [cell("hello world")],
  itemCount: 1,
  members: [],
  enabled: true,
};

describe("useColumnAutoFit", () => {
  it("returns nothing before hydration", () => {
    const { result } = renderHook(() =>
      useColumnAutoFit({ ...base, enabled: false }),
    );
    expect(result.current).toEqual({});
  });

  it("fits the columns that have no saved width", () => {
    const { result } = renderHook(() => useColumnAutoFit(base));
    // "hello world" 77 + 16 = 93 (header floor for "Notes" here is 35 + 6 + 48 = 89)
    expect(result.current).toEqual({ c1: 93 });
  });

  it("does not refit when only a cell value changes", () => {
    const { result, rerender } = renderHook((p: Props) => useColumnAutoFit(p), {
      initialProps: base,
    });
    const first = result.current;
    rerender({ ...base, cellValues: [cell("x".repeat(30))] });
    expect(result.current).toBe(first);
    expect(result.current.c1).toBe(93);
  });

  it("refits when the number of items changes", () => {
    const { result, rerender } = renderHook((p: Props) => useColumnAutoFit(p), {
      initialProps: base,
    });
    rerender({
      ...base,
      cellValues: [cell("hello world"), cell("x".repeat(30))],
      itemCount: 2,
    });
    expect(result.current.c1).toBe(30 * 7 + 16);
  });

  it("refits when the set of columns changes", () => {
    const { result, rerender } = renderHook((p: Props) => useColumnAutoFit(p), {
      initialProps: base,
    });
    rerender({
      ...base,
      columns: [...columns, { ...columns[0], id: "c3", name: "Extra" }],
    });
    expect(Object.keys(result.current).sort()).toEqual(["c1", "c3"]);
  });
});

describe("fit fonts", () => {
  it("measure at the sizes the table renders", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const px = (re: RegExp) => `${Number(css.match(re)![1]) * 16}px`;
    expect(FIT_FONT_SIZES.cell).toBe(
      px(/\[data-board-table\]\s+\.text-cell\s*\{\s*font-size:\s*([\d.]+)rem/),
    );
    expect(FIT_FONT_SIZES.mono).toBe(px(/--text-2xs:\s*([\d.]+)rem/));
    expect(FIT_FONT_SIZES.header).toBe(px(/--text-3xs:\s*([\d.]+)rem/));
    expect(FIT_FONT_SIZES.chip).toBe("12px"); // Tailwind's text-xs
  });

  it("use the live next/font families, not bare literals", () => {
    const fonts = buildFitFonts("'__Inter_abc'", "'__JetBrains_def'");
    expect(fonts.cell).toBe(
      "400 12.5px '__Inter_abc', ui-sans-serif, system-ui, sans-serif",
    );
    expect(fonts.chip).toContain("500 12px '__Inter_abc'");
    expect(fonts.header).toContain("500 10px '__JetBrains_def'");
    expect(fonts.mono).toContain("500 11px '__JetBrains_def'");
  });

  it("fall back to the literal families when the variables are empty (jsdom)", () => {
    const fonts = buildFitFonts("", "  ");
    expect(fonts.cell).toContain("Inter,");
    expect(fonts.header).toContain("JetBrains Mono");
  });
});
