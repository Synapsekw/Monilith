import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChartWidget } from "@/components/dashboards/widgets/ChartWidget";
import type { SeriesData } from "@/lib/dashboards/series";

const sample: SeriesData = {
  chartType: "bar",
  primaryKind: "status",
  seriesKind: null,
  points: [
    {
      primaryKey: "done",
      primaryLabel: "Done",
      seriesKey: null,
      seriesLabel: null,
      seriesColor: "#34d399",
      value: 4,
    },
  ],
};

vi.mock("@/lib/dashboards/use-widget-series", () => ({
  useWidgetSeries: () => ({ data: sample, isLoading: false, isError: false }),
}));

// recharts needs a sized container in jsdom; stub ResponsiveContainer.
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 300 }}>{children}</div>
    ),
  };
});

describe("ChartWidget", () => {
  it("renders a bar chart without crashing", () => {
    const { container } = render(
      <ChartWidget
        widget={
          {
            id: "w1",
            source_board_id: "b1",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c1" },
            },
          } as never
        }
      />,
    );
    // recharts renders its chart tree under the stubbed container div
    expect(container.firstChild).not.toBeNull();
  });

  it("wires series colors into the ChartContainer style block", () => {
    const { container } = render(
      <ChartWidget
        widget={
          {
            id: "w2",
            source_board_id: "b1",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c1" },
            },
          } as never
        }
      />,
    );
    // ChartContainer injects a <style> setting --color-<key> from the config.
    // Single-series -> the synthetic "Value" series carries SOLO_COLOR.
    expect(container.innerHTML).toContain("--color-Value");
    expect(container.innerHTML).toContain("#818cf8");
  });
});
