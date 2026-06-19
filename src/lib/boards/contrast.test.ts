import { describe, it, expect } from "vitest";
import {
  pillTextColor,
  contrastRatio,
  LIGHT_FG,
  DARK_FG,
} from "@/lib/boards/contrast";

describe("pillTextColor", () => {
  it("uses dark text on white and white text on black", () => {
    expect(pillTextColor("#ffffff")).toBe(DARK_FG);
    expect(pillTextColor("#000000")).toBe(LIGHT_FG);
  });

  it("falls back to white on unparseable input (prior behavior)", () => {
    expect(pillTextColor("")).toBe(LIGHT_FG);
    expect(pillTextColor("not-a-color")).toBe(LIGHT_FG);
    expect(pillTextColor("#12")).toBe(LIGHT_FG);
  });

  it("supports 3-digit hex", () => {
    expect(pillTextColor("#fff")).toBe(DARK_FG);
    expect(pillTextColor("#000")).toBe(LIGHT_FG);
  });

  it("always picks the higher-contrast foreground for palette colors", () => {
    const palette = [
      "#00c875",
      "#fdab3d",
      "#e2445c",
      "#c4c4c4",
      "#808080",
      "#6366f1",
      "#8b5cf6",
      "#38bdf8",
      "#ec4899",
      "#14b8a6",
      "#f97316",
    ];
    for (const bg of palette) {
      const chosen = pillTextColor(bg);
      const other = chosen === LIGHT_FG ? DARK_FG : LIGHT_FG;
      expect(contrastRatio(bg, chosen)).toBeGreaterThanOrEqual(
        contrastRatio(bg, other),
      );
    }
  });

  it("flips pale fills (e.g. grey) to dark text so they stay legible", () => {
    expect(pillTextColor("#c4c4c4")).toBe(DARK_FG);
    expect(pillTextColor("#fdab3d")).toBe(DARK_FG);
  });

  it("keeps white text on the brand indigo", () => {
    expect(pillTextColor("#6366f1")).toBe(LIGHT_FG);
  });
});
