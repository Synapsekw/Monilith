import { describe, expect, it } from "vitest";

import { buildChartConfig } from "@/components/dashboards/widgets/chart-config";

describe("buildChartConfig", () => {
  it("maps each series to a label + color entry", () => {
    const config = buildChartConfig([
      { key: "Ada", color: "#34d399" },
      { key: "Lin", color: "#6366f1" },
    ]);
    expect(config).toEqual({
      Ada: { label: "Ada", color: "#34d399" },
      Lin: { label: "Lin", color: "#6366f1" },
    });
  });

  it("maps the single synthetic Value series (preserving SOLO_COLOR)", () => {
    const config = buildChartConfig([{ key: "Value", color: "#818cf8" }]);
    expect(config).toEqual({ Value: { label: "Value", color: "#818cf8" } });
  });

  it("returns an empty config for no series", () => {
    expect(buildChartConfig([])).toEqual({});
  });
});
