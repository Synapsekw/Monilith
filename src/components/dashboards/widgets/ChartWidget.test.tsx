import { cloneElement } from "react";
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
      seriesColor: null,
      value: 4,
    },
  ],
};

vi.mock("@/lib/dashboards/use-widget-series", () => ({
  useWidgetSeries: () => ({ data: sample, isLoading: false, isError: false }),
}));

// recharts needs a sized container in jsdom; stub ResponsiveContainer.
// jsdom never runs the real ResizeObserver measurement, so recharts charts
// bail out with no <svg> unless width/height are cloned onto the chart
// element directly (the outer div's inline style alone isn't enough).
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return {
    ...mod,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement<{ width?: number; height?: number }>;
    }) => (
      <div style={{ width: 400, height: 300 }}>
        {cloneElement(children, { width: 400, height: 300 })}
      </div>
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
    // Single-series, uncolored -> the synthetic "Value" series resolves to
    // the spectrum hero solid representative (SPECTRUM_SOLID).
    expect(container.innerHTML).toContain("--color-Value");
    expect(container.innerHTML).toContain("#7c3aed");
  });

  it("renders the spectrum hero gradient + glow defs for an uncolored single series", () => {
    const { container } = render(
      <ChartWidget
        widget={
          {
            id: "w9",
            source_board_id: "b1",
            config: {
              chartType: "bar",
              primary: { kind: "date", columnId: "c1" },
            },
          } as never
        }
      />,
    );
    // hero vertical bar gradient id (from chart-colors.gradientId) + glow filter
    expect(container.querySelector("#g-w9-bar-hero")).not.toBeNull();
    expect(container.querySelector("#glow-w9")).not.toBeNull();
  });
});
