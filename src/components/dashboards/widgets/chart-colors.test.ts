import { describe, expect, it } from "vitest";

import {
  resolveChartColors,
  gradientId,
  solidOf,
  paintFill,
  paintStroke,
  collectGradients,
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

  it("radial always colors per-cell (categorical fallback), never hero", () => {
    const c = resolveChartColors({
      chartType: "radial",
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
    expect(c.cells?.some((cell) => cell.paint.kind === "hero")).toBe(false);
  });

  it("helpers: solidOf(hero) is the spectrum solid; gradientId is deterministic & id-safe", () => {
    expect(solidOf({ kind: "hero" })).toBe(SPECTRUM_SOLID);
    expect(solidOf({ kind: "solid", color: "#abc" })).toBe("#abc");
    const id = gradientId("w1", "bar", "var(--chart-cat-1)");
    expect(id).toBe(gradientId("w1", "bar", "var(--chart-cat-1)"));
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe("paintFill", () => {
  it("hero paint resolves to the hero gradient url for the given role", () => {
    expect(paintFill("w1", { kind: "hero" }, "bar")).toBe(
      `url(#${gradientId("w1", "bar", "hero")})`,
    );
    expect(paintFill("w1", { kind: "hero" }, "bar")).toBe(
      "url(#g-w1-bar-hero)",
    );
  });

  it("solid paint resolves to a color-keyed gradient url for the given role", () => {
    expect(paintFill("w1", { kind: "solid", color: "#34d399" }, "area")).toBe(
      `url(#${gradientId("w1", "area", "#34d399")})`,
    );
    expect(paintFill("w1", { kind: "solid", color: "#34d399" }, "area")).toBe(
      "url(#g-w1-area-34d399)",
    );
  });
});

describe("paintStroke", () => {
  it("hero paint resolves to the stroke gradient url", () => {
    expect(paintStroke("w1", { kind: "hero" })).toBe(
      `url(#${gradientId("w1", "stroke", "hero")})`,
    );
    expect(paintStroke("w1", { kind: "hero" })).toBe("url(#g-w1-stroke-hero)");
  });

  it("solid paint resolves to the raw color, not a url()", () => {
    expect(paintStroke("w1", { kind: "solid", color: "#abc" })).toBe("#abc");
  });
});

describe("collectGradients", () => {
  it("hero contributes 3 specs, solids contribute 2 each, dedupes by id", () => {
    const colors = {
      series: [
        { key: "A", paint: { kind: "hero" as const } },
        {
          key: "B",
          paint: { kind: "solid" as const, color: "#111111" },
        },
        {
          key: "C",
          paint: { kind: "solid" as const, color: "#111111" },
        },
      ],
      cells: null,
    };

    const specs = collectGradients("w1", colors);

    // hero (3) + one unique solid color (2) — the duplicate color contributes
    // no new specs because its ids collide with the first solid's.
    expect(specs).toHaveLength(5);
    expect(new Set(specs.map((s) => s.kind))).toEqual(
      new Set(["hero-bar", "hero-area", "hero-stroke", "bar", "area"]),
    );

    const byId = new Map(specs.map((s) => [s.id, s]));
    expect(byId.get(gradientId("w1", "bar", "hero"))?.kind).toBe("hero-bar");
    expect(byId.get(gradientId("w1", "area", "hero"))?.kind).toBe("hero-area");
    expect(byId.get(gradientId("w1", "stroke", "hero"))?.kind).toBe(
      "hero-stroke",
    );
    expect(byId.get(gradientId("w1", "bar", "#111111"))?.kind).toBe("bar");
    expect(byId.get(gradientId("w1", "area", "#111111"))?.kind).toBe("area");

    // ids are unique — dedup worked.
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
  });
});
