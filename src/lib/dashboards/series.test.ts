import { describe, expect, it } from "vitest";

import { pivotSeries, type SeriesData } from "@/lib/dashboards/series";

const data: SeriesData = {
  chartType: "stackedBar",
  primaryKind: "status",
  seriesKind: "people",
  points: [
    {
      primaryKey: "done",
      primaryLabel: "Done",
      seriesKey: "u1",
      seriesLabel: "Ada",
      seriesColor: "#34d399",
      value: 3,
    },
    {
      primaryKey: "done",
      primaryLabel: "Done",
      seriesKey: "u2",
      seriesLabel: "Lin",
      seriesColor: "#6366f1",
      value: 1,
    },
    {
      primaryKey: "wip",
      primaryLabel: "WIP",
      seriesKey: "u1",
      seriesLabel: "Ada",
      seriesColor: "#34d399",
      value: 2,
    },
  ],
};

describe("pivotSeries", () => {
  it("pivots flat points into recharts rows keyed by series label", () => {
    const out = pivotSeries(data);
    expect(out.rows).toEqual([
      { __label: "Done", Ada: 3, Lin: 1 },
      { __label: "WIP", Ada: 2 },
    ]);
  });

  it("returns the distinct series with their colors", () => {
    const out = pivotSeries(data);
    expect(out.series).toEqual([
      { key: "Ada", color: "#34d399" },
      { key: "Lin", color: "#6366f1" },
    ]);
  });

  it("uses a single synthetic series when there is no series split", () => {
    const out = pivotSeries({
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
          value: 5,
        },
      ],
    });
    expect(out.rows).toEqual([
      { __label: "Done", Value: 5, __color_Done: "#34d399" },
    ]);
    expect(out.series).toEqual([{ key: "Value", color: "#818cf8" }]);
  });
});
