import { cloneElement } from "react";
import { render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChartWidget } from "@/components/dashboards/widgets/ChartWidget";
import {
  CATEGORICAL_PALETTE,
  SPECTRUM_SOLID,
} from "@/components/dashboards/widgets/chart-theme";
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

// Per-test overrides: the series the widget reads, and the box recharts is
// told it has (jsdom lays nothing out, so the size is injected below).
const h = vi.hoisted(() => ({
  data: null as unknown,
  dims: { width: 400, height: 300 },
}));

vi.mock("@/lib/dashboards/use-widget-series", () => ({
  useWidgetSeries: () => ({
    data: h.data ?? sample,
    isLoading: false,
    isError: false,
  }),
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
      <div style={{ ...h.dims }}>{cloneElement(children, { ...h.dims })}</div>
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
    expect(container.innerHTML).toContain(SPECTRUM_SOLID);
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

// ── circular charts, donut total, legend ─────────────────────────────────────

const STAGES: [string, number, string | null][] = [
  ["Backlog", 14, "#9ca3af"],
  ["In Progress", 9, null],
  ["Review", 5, "#f59e0b"],
  ["Done", 1200, "#22c55e"],
];

function circular(chartType: "pie" | "donut" | "radial"): SeriesData {
  return {
    chartType,
    primaryKind: "status",
    seriesKind: null,
    points: STAGES.map(([label, value, color]) => ({
      primaryKey: label,
      primaryLabel: label,
      seriesKey: null,
      seriesLabel: null,
      seriesColor: color,
      value,
    })),
  };
}

const stacked: SeriesData = {
  chartType: "stackedBar",
  primaryKind: "people",
  seriesKind: "status",
  points: ["Ana", "Ben"].flatMap((person, i) =>
    (
      [
        ["To Do", 3, "#9ca3af"],
        ["In Progress", 2, null],
        ["Done", 5, "#22c55e"],
      ] as [string, number, string | null][]
    ).map(([label, value, color]) => ({
      primaryKey: person,
      primaryLabel: person,
      seriesKey: label,
      seriesLabel: label,
      seriesColor: color,
      value: value + i,
    })),
  ),
};

const widget = (id: string) =>
  ({ id, source_board_id: "b1", config: {} }) as never;

/** A v2 chart widget whose measure uses the given aggregate. */
const measured = (id: string, chartType: string, agg: string) =>
  ({
    id,
    source_board_id: "b1",
    config: {
      chartType,
      primary: { kind: "status", columnId: "c1" },
      measure: agg === "count" ? { agg } : { agg, valueColumnId: "c-numbers" },
    },
  }) as never;

/** Angle (degrees, 0 = 3 o'clock, counter-clockwise) of an SVG point. */
function angleOf(x: number, y: number, cx: number, cy: number) {
  const deg = (Math.atan2(cy - y, x - cx) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Degrees swept by a recharts sector path's OUTER arc: `M x,y A r,r,0,L,S,x,y …`.
 * A sector that has not been swept yet (entrance animation at t=0) starts and
 * ends on the same point, so it reads as 0.
 */
function sweepOf(d: string, cx: number, cy: number): number {
  const numbers = (cmd: string) =>
    (new RegExp(`${cmd}([^A-Za-z]*)`).exec(d)?.[1] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
  const [x1, y1] = numbers("M");
  const [, , , largeArc, , x2, y2] = numbers("A");
  if (x1 == null || y1 == null || x2 == null || y2 == null) return 0;
  // Start and end coincide: either nothing swept yet, or (large-arc) the whole
  // circle — recharts caps a full sector at 359.999 degrees.
  if (Math.hypot(x2 - x1, y2 - y1) < 0.05) return largeArc === 1 ? 360 : 0;
  return (angleOf(x2, y2, cx, cy) - angleOf(x1, y1, cx, cy) + 360) % 360;
}

function sectorSweeps(container: HTMLElement, selector: string) {
  const { width, height } = h.dims;
  return [...container.querySelectorAll<SVGPathElement>(selector)].map((p) =>
    sweepOf(p.getAttribute("d") ?? "", width / 2, height / 2),
  );
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("ChartWidget circular charts draw their final geometry on first paint", () => {
  afterEach(() => {
    h.data = null;
    h.dims = { width: 400, height: 300 };
    vi.restoreAllMocks();
  });

  // ROOT CAUSE GUARD. recharts drives the Pie / RadialBar entrance sweep from
  // requestAnimationFrame and restarts it whenever the element re-renders, so
  // the mark is only complete if every frame of an uninterrupted run arrives.
  // A widget must not depend on that: with NO animation frame ever delivered
  // the circle has to be whole.
  function freezeAnimationFrames() {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  }

  it.each(["pie", "donut"] as const)(
    "%s sweeps the full 360 degrees with no animation frame delivered",
    (ct) => {
      freezeAnimationFrames();
      h.data = circular(ct);
      const { container } = render(<ChartWidget widget={widget(`w-${ct}`)} />);
      const sweeps = sectorSweeps(container, ".recharts-pie-sector path");
      expect(sweeps).toHaveLength(STAGES.length);
      expect(sum(sweeps)).toBeCloseTo(360, 0);
    },
  );

  it("radial draws its largest bar as a full ring with no animation frame delivered", () => {
    freezeAnimationFrames();
    h.data = circular("radial");
    const { container } = render(<ChartWidget widget={widget("w-radial")} />);
    const sweeps = sectorSweeps(container, "path.recharts-radial-bar-sector");
    expect(sweeps).toHaveLength(STAGES.length);
    expect(Math.max(...sweeps)).toBeCloseTo(360, 0);
  });

  it("stays a full circle when the widget re-renders mid-entrance", () => {
    freezeAnimationFrames();
    h.data = circular("donut");
    const view = render(<ChartWidget widget={widget("w-rr")} />);
    for (let i = 0; i < 3; i++)
      view.rerender(<ChartWidget widget={widget("w-rr")} />);
    expect(
      sum(sectorSweeps(view.container, ".recharts-pie-sector path")),
    ).toBeCloseTo(360, 0);
  });

  it("is a full circle at the smallest box the grid allows (a 1x1 cell body)", () => {
    freezeAnimationFrames();
    // 1 column x 1 row (rowHeight 80) minus the card header and p-3 padding.
    h.dims = { width: 64, height: 20 };
    h.data = circular("pie");
    const { container } = render(<ChartWidget widget={widget("w-min")} />);
    const sweeps = sectorSweeps(container, ".recharts-pie-sector path");
    expect(sweeps).toHaveLength(STAGES.length);
    expect(sum(sweeps)).toBeCloseTo(360, 0);
  });
});

describe("ChartWidget donut total", () => {
  afterEach(() => {
    h.data = null;
  });

  it("shows the grand total in the centre of a donut", () => {
    h.data = circular("donut");
    const { getByTestId } = render(<ChartWidget widget={widget("w-total")} />);
    expect(getByTestId("chart-total")).toHaveTextContent("1,228");
  });

  it.each(["sum", "count"] as const)(
    "keeps the centre total for an additive %s measure",
    (agg) => {
      h.data = circular("donut");
      const { getByTestId } = render(
        <ChartWidget widget={measured(`w-total-${agg}`, "donut", agg)} />,
      );
      expect(getByTestId("chart-total")).toHaveTextContent("1,228");
    },
  );

  // A sum of per-slice averages is not the average of anything.
  it("shows no centre total when the measure is an average", () => {
    h.data = circular("donut");
    const { queryByTestId, container } = render(
      <ChartWidget widget={measured("w-total-avg", "donut", "avg")} />,
    );
    expect(queryByTestId("chart-total")).toBeNull();
    // ...but each slice still reports its own (correct) value.
    expect(
      [...container.querySelectorAll("[data-testid=chart-legend-value]")].map(
        (n) => n.textContent,
      ),
    ).toEqual(["14", "9", "5", "1,200"]);
  });

  it("treats an aggregate it does not know as non-additive", () => {
    h.data = circular("donut");
    const { queryByTestId } = render(
      <ChartWidget widget={measured("w-total-max", "donut", "max")} />,
    );
    expect(queryByTestId("chart-total")).toBeNull();
  });

  it("does not show a centre total on a pie", () => {
    h.data = circular("pie");
    const { queryByTestId } = render(<ChartWidget widget={widget("w-pie")} />);
    expect(queryByTestId("chart-total")).toBeNull();
  });
});

describe("ChartWidget legend", () => {
  afterEach(() => {
    h.data = null;
  });

  function legendRows(container: HTMLElement) {
    return [
      ...container.querySelectorAll<HTMLElement>(
        "[data-slot=chart-legend-item]",
      ),
    ].map((li) => ({
      name: within(li).getByTestId("chart-legend-name").textContent,
      value: within(li).getByTestId("chart-legend-value").textContent,
      color: within(li)
        .getByTestId("chart-legend-key")
        .getAttribute("data-color"),
    }));
  }

  it.each(["pie", "donut", "radial"] as const)(
    "%s lists every slice with its colour key, name and value",
    (ct) => {
      h.data = circular(ct);
      const { container } = render(<ChartWidget widget={widget(`l-${ct}`)} />);
      expect(legendRows(container)).toEqual([
        { name: "Backlog", value: "14", color: "#9ca3af" },
        // uncoloured slice -> categorical palette by slice index
        { name: "In Progress", value: "9", color: CATEGORICAL_PALETTE[1] },
        { name: "Review", value: "5", color: "#f59e0b" },
        { name: "Done", value: "1,200", color: "#22c55e" },
      ]);
    },
  );

  it("stacked bar lists every series with its colour key, name and total", () => {
    h.data = stacked;
    const { container } = render(<ChartWidget widget={widget("l-stack")} />);
    expect(legendRows(container)).toEqual([
      { name: "To Do", value: "7", color: "#9ca3af" },
      { name: "In Progress", value: "5", color: CATEGORICAL_PALETTE[1] },
      { name: "Done", value: "11", color: "#22c55e" },
    ]);
  });

  it.each(["sum", "count"] as const)(
    "keeps the per-series total for an additive %s measure",
    (agg) => {
      h.data = stacked;
      const { container } = render(
        <ChartWidget widget={measured(`l-stack-${agg}`, "stackedBar", agg)} />,
      );
      expect(legendRows(container).map((r) => r.value)).toEqual([
        "7",
        "5",
        "11",
      ]);
    },
  );

  // Summing a series' per-bucket averages across the axis is misinformation:
  // the legend keeps its names and colour keys and drops the number.
  it.each(["stackedBar", "line"] as const)(
    "%s with an average measure lists names and colour keys but no summed value",
    (ct) => {
      h.data = { ...stacked, chartType: ct };
      const { container } = render(
        <ChartWidget widget={measured(`l-avg-${ct}`, ct, "avg")} />,
      );
      const items = [
        ...container.querySelectorAll<HTMLElement>(
          "[data-slot=chart-legend-item]",
        ),
      ];
      expect(
        items.map((li) => ({
          name: within(li).getByTestId("chart-legend-name").textContent,
          color: within(li)
            .getByTestId("chart-legend-key")
            .getAttribute("data-color"),
        })),
      ).toEqual([
        { name: "To Do", color: "#9ca3af" },
        { name: "In Progress", color: CATEGORICAL_PALETTE[1] },
        { name: "Done", color: "#22c55e" },
      ]);
      expect(
        container.querySelectorAll("[data-testid=chart-legend-value]"),
      ).toHaveLength(0);
    },
  );

  it("paints each key with the same colour as its mark", () => {
    h.data = circular("pie");
    const { container } = render(<ChartWidget widget={widget("l-paint")} />);
    const key = container.querySelector<HTMLElement>(
      "[data-testid=chart-legend-key]",
    )!;
    // The key is a real painted swatch, not a `url(#gradient)` reference
    // (which is what recharts' own legend payload carried: an invalid
    // background-color, i.e. no key at all).
    expect(key.style.backgroundColor).not.toBe("");
    expect(key.getAttribute("data-color")).not.toMatch(/^url\(/);
    // ...and the first slice is filled from that same colour's gradient.
    expect(container.querySelector("#g-l-paint-bar-9ca3af")).not.toBeNull();
  });
});
