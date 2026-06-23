import { describe, expect, it } from "vitest";

import { normalizeChartConfig } from "@/lib/dashboards/chart-config";

describe("normalizeChartConfig", () => {
  it("maps a legacy bar config to the new shape", () => {
    const out = normalizeChartConfig({
      groupColumnId: "col-1",
      chartStyle: "bar",
    });
    expect(out).toEqual({
      chartType: "bar",
      primary: { kind: "status", columnId: "col-1" },
      measure: { agg: "count" },
    });
  });

  it("maps a legacy pie config to chartType pie", () => {
    const out = normalizeChartConfig({
      groupColumnId: "col-1",
      chartStyle: "pie",
    });
    expect(out.chartType).toBe("pie");
    expect(out.primary).toEqual({ kind: "status", columnId: "col-1" });
  });

  it("passes a new-shape config through unchanged", () => {
    const cfg = {
      chartType: "line" as const,
      primary: { kind: "date" as const, bucket: "month" as const },
      measure: { agg: "count" as const },
    };
    expect(normalizeChartConfig(cfg)).toEqual(cfg);
  });

  it("defaults missing measure to count", () => {
    const out = normalizeChartConfig({
      chartType: "donut",
      primary: {
        kind: "status",
        columnId: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(out.measure).toEqual({ agg: "count" });
  });
});
