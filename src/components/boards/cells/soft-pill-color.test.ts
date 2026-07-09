import { describe, expect, it } from "vitest";
import { softPillText } from "./soft-pill-color";
import { contrastRatio } from "@/lib/boards/contrast";

// Reconstruct the soft pill's *effective* (tinted) background — the 15% option
// tint composited over the board surface — so the AA check matches what renders.
function parse(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}
function toHex([r, g, b]: number[]): string {
  return (
    "#" +
    [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")
  );
}
function tintedBg(hex: string, surface: string): string {
  const fg = parse(hex);
  const bg = parse(surface);
  return toHex(fg.map((v, i) => v * 0.15 + bg[i] * 0.85));
}
const LIGHT_SURFACE = "#ffffff"; // bg-surface (light)
const DARK_SURFACE = "#161619"; // bg-surface (dark)

describe("softPillText (soft status pill contrast)", () => {
  // Spot-check colors, incl. the two that the previous fixed blend failed on.
  const colors = [
    "#1e3a8a", // navy — dark hue (failed dark-on-dark before)
    "#fde047", // pale yellow — light hue (failed pale-on-white before)
    "#8b5cf6", // mid purple
    "#00c875", // status green
    "#ff5ac4", // hot pink
  ];

  it.each(colors)("keeps the pill label ≥4.5:1 in both themes (%s)", (hex) => {
    const { light, dark } = softPillText(hex);
    expect(
      contrastRatio(light, tintedBg(hex, LIGHT_SURFACE)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(dark, tintedBg(hex, DARK_SURFACE)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("lifts a too-dark hue toward legibility in dark mode (navy would fail raw)", () => {
    const hex = "#1e3a8a";
    // The naive "raw color as text" the earlier blend used fails AA on the dark fill…
    expect(contrastRatio(hex, tintedBg(hex, DARK_SURFACE))).toBeLessThan(4.5);
    // …but the derived dark-mode text clears it (and differs from the raw hex).
    const { dark } = softPillText(hex);
    expect(dark.toLowerCase()).not.toBe(hex);
    expect(
      contrastRatio(dark, tintedBg(hex, DARK_SURFACE)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("darkens a too-pale hue toward legibility in light mode (pale yellow would fail raw)", () => {
    const hex = "#fde047";
    expect(contrastRatio(hex, tintedBg(hex, LIGHT_SURFACE))).toBeLessThan(4.5);
    const { light } = softPillText(hex);
    expect(light.toLowerCase()).not.toBe(hex);
    expect(
      contrastRatio(light, tintedBg(hex, LIGHT_SURFACE)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("returns distinct per-theme text colors (theme-aware)", () => {
    const { light, dark } = softPillText("#1e3a8a");
    expect(light).not.toBe(dark);
  });

  it("falls back to legible defaults for an unparseable color", () => {
    expect(softPillText("not-a-color")).toEqual({
      light: "#1a1a1d",
      dark: "#ffffff",
    });
  });
});
