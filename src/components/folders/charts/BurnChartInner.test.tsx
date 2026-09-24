import { cloneElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BurnChartInner } from "./BurnChartInner";
import type { BurnPoint } from "@/lib/folders/rollup";

// recharts needs a sized container in jsdom; stub ResponsiveContainer. jsdom
// never runs the real ResizeObserver measurement, so recharts charts bail out
// with no <svg> unless width/height are cloned onto the chart element
// directly (the outer div's inline style alone isn't enough) — same pattern
// as src/components/dashboards/widgets/ChartWidget.test.tsx.
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return {
    ...mod,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement<{ width?: number; height?: number }>;
    }) => (
      <div style={{ width: 640, height: 256 }}>
        {cloneElement(children, { width: 640, height: 256 })}
      </div>
    ),
  };
});

const points: BurnPoint[] = [
  {
    weekStart: "2026-09-07",
    planned: 2,
    completed: 1,
    plannedCum: 2,
    completedCum: 1,
    isPast: true,
  },
  {
    weekStart: "2026-09-14",
    planned: 3,
    completed: 1,
    plannedCum: 5,
    completedCum: 2,
    isPast: true,
  },
  {
    weekStart: "2026-09-21",
    planned: 1,
    completed: 0,
    plannedCum: 6,
    completedCum: 2,
    isPast: false,
  },
];

describe("BurnChartInner", () => {
  it("renders planned (dashed), completed (area) and a Today reference line in cumulative mode", () => {
    const { container } = render(
      <BurnChartInner points={points} mode="cumulative" />,
    );
    expect(container.querySelector("[data-slot='chart']")).not.toBeNull();
    expect(container.querySelector(".recharts-reference-line")).not.toBeNull();
    expect(container.querySelector(".recharts-area")).not.toBeNull();
    expect(container.querySelector(".recharts-line")).not.toBeNull();
  });
  it("switches to bars in weekly mode", () => {
    const { container } = render(
      <BurnChartInner points={points} mode="weekly" />,
    );
    expect(container.querySelector(".recharts-bar")).not.toBeNull();
    expect(container.querySelector(".recharts-area")).toBeNull();
  });
});
