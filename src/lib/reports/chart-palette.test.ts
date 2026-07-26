import { describe, expect, it } from "vitest";
import {
  PRINT_CATEGORICAL,
  PRINT_NEUTRAL,
  rampSlot,
} from "@/lib/reports/chart-palette";
import { REPORT_CSS } from "@/lib/reports/report-css";

describe("report print chart palette", () => {
  it("is the exact validated eight-hex ramp (do not edit without re-validating)", () => {
    expect([...PRINT_CATEGORICAL]).toEqual([
      "#5866c4",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
      "#4a3aa7",
      "#e34948",
    ]);
  });

  it("slot 1 is the report's own periwinkle accent", () => {
    expect(PRINT_CATEGORICAL[0]).toBe("#5866c4");
    expect(REPORT_CSS).toContain("--peri:#5866c4");
  });

  it("the neutral is not a categorical slot", () => {
    expect(PRINT_NEUTRAL).toBe("#9aa1b1");
    expect(PRINT_CATEGORICAL).not.toContain(PRINT_NEUTRAL);
  });

  it("rampSlot is stable and wraps only past the eighth slot", () => {
    expect(rampSlot(0)).toBe("#5866c4");
    expect(rampSlot(5)).toBe("#008300");
    expect(rampSlot(8)).toBe("#5866c4");
    expect(rampSlot(0)).toBe(rampSlot(0));
  });

  it("REPORT_CSS declares the chart classes and page-break protection", () => {
    for (const cls of [
      ".r-chart",
      ".r-chart-ring",
      ".r-chart-legend",
      ".r-lg-row",
      ".r-lg-sw",
      ".r-bar-row",
      ".r-bar-track",
      ".r-bar-fill",
      ".r-chart-empty",
    ]) {
      expect(REPORT_CSS).toContain(cls);
    }
    expect(REPORT_CSS).toContain("page-break-inside:avoid");
  });
});
