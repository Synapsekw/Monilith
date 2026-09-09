import { describe, expect, it } from "vitest";
import { SPECTRUM_SOLID, SPECTRUM_STOPS } from "./chart-theme";

// The spectrum hero gradient used to hardcode indigo/violet/pink hexes. It now
// derives from --brand via --chart-spectrum-1..3 (globals.css), so every
// theme preset gets a coherent ramp for free — assert the tokens, not a hex.
describe("chart-theme spectrum tokens", () => {
  it("SPECTRUM_STOPS is the three chart-spectrum CSS variables, in order", () => {
    expect(SPECTRUM_STOPS).toEqual([
      "var(--chart-spectrum-1)",
      "var(--chart-spectrum-2)",
      "var(--chart-spectrum-3)",
    ]);
  });

  it("SPECTRUM_SOLID is the mid spectrum stop", () => {
    expect(SPECTRUM_SOLID).toBe("var(--chart-spectrum-2)");
    expect(SPECTRUM_SOLID).toBe(SPECTRUM_STOPS[1]);
  });

  it("contains no hardcoded hex literal", () => {
    for (const stop of [...SPECTRUM_STOPS, SPECTRUM_SOLID]) {
      expect(stop).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });
});
