import { describe, expect, it } from "vitest";

import {
  resolveChartColors,
  gradientId,
  solidOf,
} from "@/components/dashboards/widgets/chart-colors";
import {
  CATEGORICAL_PALETTE,
  SPECTRUM_SOLID,
} from "@/components/dashboards/widgets/chart-theme";

describe("resolveChartColors", () => {
  it("single uncolored series → hero, no per-cell coloring", () => {
    const c = resolveChartColors({
      chartType: "line",
      rows: [{ __label: "Jan", Value: 3 }],
      series: [{ key: "Value", color: null }],
    });
    expect(c.series).toEqual([{ key: "Value", paint: { kind: "hero" } }]);
    expect(c.cells).toBeNull();
  });

  it("uncolored multi-series → categorical palette by index", () => {
    const c = resolveChartColors({
      chartType: "line",
      rows: [{ __label: "Jan", A: 1, B: 2 }],
      series: [
        { key: "A", color: null },
        { key: "B", color: null },
      ],
    });
    expect(c.series).toEqual([
      { key: "A", paint: { kind: "solid", color: CATEGORICAL_PALETTE[0] } },
      { key: "B", paint: { kind: "solid", color: CATEGORICAL_PALETTE[1] } },
    ]);
  });

  it("configured series colors win over the palette", () => {
    const c = resolveChartColors({
      chartType: "bar",
      rows: [{ __label: "x", A: 1, B: 2 }],
      series: [
        { key: "A", color: "#111111" },
        { key: "B", color: null },
      ],
    });
    expect(c.series[0].paint).toEqual({ kind: "solid", color: "#111111" });
    expect(c.series[1].paint).toEqual({
      kind: "solid",
      color: CATEGORICAL_PALETTE[1],
    });
  });

  it("single bar with per-cell colors → per-cell solids (no hero)", () => {
    const c = resolveChartColors({
      chartType: "bar",
      rows: [
        { __label: "Done", Value: 3, __color_Done: "#34d399" },
        { __label: "WIP", Value: 1, __color_WIP: "#f59e0b" },
      ],
      series: [{ key: "Value", color: null }],
    });
    expect(c.cells).toEqual([
      { label: "Done", paint: { kind: "solid", color: "#34d399" } },
      { label: "WIP", paint: { kind: "solid", color: "#f59e0b" } },
    ]);
  });

  it("single bar with NO per-cell colors → hero, cells null", () => {
    const c = resolveChartColors({
      chartType: "bar",
      rows: [
        { __label: "Jan", Value: 3 },
        { __label: "Feb", Value: 5 },
      ],
      series: [{ key: "Value", color: null }],
    });
    expect(c.cells).toBeNull();
    expect(c.series[0].paint).toEqual({ kind: "hero" });
  });

  it("pie always colors per-cell (categorical fallback), never hero", () => {
    const c = resolveChartColors({
      chartType: "pie",
      rows: [
        { __label: "A", Value: 1 },
        { __label: "B", Value: 2 },
      ],
      series: [{ key: "Value", color: null }],
    });
    expect(c.cells).toEqual([
      { label: "A", paint: { kind: "solid", color: CATEGORICAL_PALETTE[0] } },
      { label: "B", paint: { kind: "solid", color: CATEGORICAL_PALETTE[1] } },
    ]);
  });

  it("helpers: solidOf(hero) is the spectrum solid; gradientId is deterministic & id-safe", () => {
    expect(solidOf({ kind: "hero" })).toBe(SPECTRUM_SOLID);
    expect(solidOf({ kind: "solid", color: "#abc" })).toBe("#abc");
    const id = gradientId("w1", "bar", "var(--chart-cat-1)");
    expect(id).toBe(gradientId("w1", "bar", "var(--chart-cat-1)"));
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});
