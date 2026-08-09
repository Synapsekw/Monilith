import { describe, expect, it } from "vitest";
import {
  buildReportBoardData,
  mergeChartSeries,
  poolKpis,
} from "@/lib/reports/aggregate";
import type { ChartSeries } from "@/lib/reports/chart-data";
import type { Kpis } from "@/lib/reports/shape";
import { PRINT_NEUTRAL, rampSlot } from "@/lib/reports/chart-palette";
import type { ChartBlockOptions } from "@/lib/reports/config";
import type { BoardPayload } from "@/lib/boards/queries";

// ---------------------------------------------------------------- fixtures
// File-local on purpose: the repo has no shared report fixture module, so
// these stay deliberately small (only the fields the pure functions read).

const kpis = (o: Partial<Kpis> = {}): Kpis => ({
  itemCount: 0,
  percentComplete: 0,
  overdueCount: 0,
  statusTally: [],
  ...o,
});

const cat = (key: string, label: string, value: number, color = "#000000") => ({
  key,
  label,
  value,
  color,
});

const series = (o: Partial<ChartSeries> = {}): ChartSeries => ({
  categories: [],
  total: 0,
  categoryName: "Status",
  empty: false,
  ...o,
});

const EMPTY_SERIES: ChartSeries = {
  categories: [],
  total: 0,
  categoryName: "",
  empty: true,
};

const CHART_OPTS: ChartBlockOptions = {
  variant: "donut",
  source: "status",
  columnId: null,
  title: "",
  maxCategories: 6,
  boardScope: { mode: "all" },
};

/** Minimal payload — only the fields the per-board shapers read. */
function payload(): BoardPayload {
  return {
    board: { id: "b1", name: "Roadmap" },
    columns: [
      {
        id: "c1",
        name: "Status",
        kind: "status",
        position: 0,
        settings: {
          options: [
            { id: "o1", label: "Done" },
            { id: "o2", label: "Working" },
          ],
        },
      },
    ],
    groups: [{ id: "g1", name: "Now", position: 0, color: null }],
    items: [
      { id: "i1", name: "i1", group_id: "g1", parent_id: null, position: 0 },
      { id: "i2", name: "i2", group_id: "g1", parent_id: null, position: 1 },
    ],
    cellValues: [
      { item_id: "i1", column_id: "c1", value: { optionId: "o1" } },
      { item_id: "i2", column_id: "c1", value: { optionId: "o2" } },
    ],
  } as unknown as BoardPayload;
}

const NAMES = new Map<string, string>();

// ------------------------------------------------------- buildReportBoardData

describe("buildReportBoardData", () => {
  it("composes the per-board shapers and carries board identity", () => {
    const d = buildReportBoardData(payload(), NAMES, null);
    expect(d.boardId).toBe("b1");
    expect(d.boardName).toBe("Roadmap");
    expect(d.model.columns.map((c) => c.id)).toEqual(["c1"]);
    expect(d.model.groups).toHaveLength(1);
    expect(d.kpis.itemCount).toBe(2);
    expect(d.kpis.percentComplete).toBe(50);
    expect(d.groupSummaries).toHaveLength(1);
    expect(d.groupSummaries[0].count).toBe(2);
  });

  it("leaves chartSeries null when no chart options are given", () => {
    expect(buildReportBoardData(payload(), NAMES, null).chartSeries).toBeNull();
  });

  it("computes chartSeries when chart options are given", () => {
    const d = buildReportBoardData(payload(), NAMES, CHART_OPTS);
    expect(d.chartSeries?.empty).toBe(false);
    expect(d.chartSeries?.total).toBe(2);
    expect(d.chartSeries?.categories.map((c) => c.label).sort()).toEqual([
      "Done",
      "Working",
    ]);
  });
});

// ------------------------------------------------------------------ poolKpis

describe("poolKpis", () => {
  it("returns zeros for no boards", () => {
    expect(poolKpis([])).toEqual({
      itemCount: 0,
      percentComplete: 0,
      overdueCount: 0,
      statusTally: [],
    });
  });

  it("passes a single board through unchanged", () => {
    const one = kpis({
      itemCount: 7,
      percentComplete: 43,
      overdueCount: 2,
      statusTally: [{ label: "Done", count: 3 }],
    });
    expect(poolKpis([one])).toEqual(one);
  });

  it("sums counts across three boards", () => {
    const pooled = poolKpis([
      kpis({ itemCount: 4, percentComplete: 50, overdueCount: 1 }),
      kpis({ itemCount: 6, percentComplete: 50, overdueCount: 0 }),
      kpis({ itemCount: 10, percentComplete: 50, overdueCount: 3 }),
    ]);
    expect(pooled.itemCount).toBe(20);
    expect(pooled.overdueCount).toBe(4);
    expect(pooled.percentComplete).toBe(50);
  });

  it("weights percentComplete by itemCount, not by board", () => {
    // Naive unweighted mean = (100 + 0) / 2 = 50. Item-weighted = 10.
    const pooled = poolKpis([
      kpis({ itemCount: 1, percentComplete: 100 }),
      kpis({ itemCount: 9, percentComplete: 0 }),
    ]);
    expect(pooled.percentComplete).toBe(10);
  });

  it("rounds the weighted mean", () => {
    // (3*100 + 4*0) / 7 = 42.857… → 43 (naive unweighted mean would be 50).
    const pooled = poolKpis([
      kpis({ itemCount: 3, percentComplete: 100 }),
      kpis({ itemCount: 4, percentComplete: 0 }),
    ]);
    expect(pooled.percentComplete).toBe(43);
  });

  it("returns percentComplete 0 when the pooled itemCount is 0", () => {
    const pooled = poolKpis([
      kpis({ itemCount: 0, percentComplete: 100 }),
      kpis({ itemCount: 0, percentComplete: 0 }),
    ]);
    expect(pooled.itemCount).toBe(0);
    expect(pooled.percentComplete).toBe(0);
    expect(Number.isNaN(pooled.percentComplete)).toBe(false);
  });

  it("merges statusTally by label, sorted by count desc then label asc", () => {
    const pooled = poolKpis([
      kpis({
        itemCount: 3,
        statusTally: [
          { label: "Done", count: 2 },
          { label: "Working", count: 1 },
        ],
      }),
      kpis({
        itemCount: 5,
        statusTally: [
          { label: "Working", count: 2 },
          { label: "Blocked", count: 1 },
          { label: "Done", count: 1 },
        ],
      }),
    ]);
    // Done 3 and Working 3 tie on count → label asc puts "Done" first.
    expect(pooled.statusTally).toEqual([
      { label: "Done", count: 3 },
      { label: "Working", count: 3 },
      { label: "Blocked", count: 1 },
    ]);
  });

  it("merges statusTally labels case-sensitively", () => {
    const pooled = poolKpis([
      kpis({ statusTally: [{ label: "Done", count: 2 }] }),
      kpis({ statusTally: [{ label: "done", count: 1 }] }),
    ]);
    expect(pooled.statusTally).toHaveLength(2);
    expect(pooled.statusTally.find((t) => t.label === "Done")?.count).toBe(2);
    expect(pooled.statusTally.find((t) => t.label === "done")?.count).toBe(1);
  });
});

// ----------------------------------------------------------- mergeChartSeries

describe("mergeChartSeries", () => {
  it("is empty for no inputs", () => {
    const m = mergeChartSeries([], 6);
    expect(m).toEqual({
      categories: [],
      total: 0,
      categoryName: "",
      empty: true,
    });
  });

  it("is empty when every input is empty", () => {
    const m = mergeChartSeries([EMPTY_SERIES, EMPTY_SERIES], 6);
    expect(m.empty).toBe(true);
    expect(m.categories).toEqual([]);
    expect(m.total).toBe(0);
  });

  it("ignores empty inputs and keeps the non-empty ones", () => {
    const m = mergeChartSeries(
      [
        EMPTY_SERIES,
        series({ categories: [cat("o1", "Done", 3)], total: 3 }),
        EMPTY_SERIES,
      ],
      6,
    );
    expect(m.empty).toBe(false);
    expect(m.total).toBe(3);
    expect(m.categories).toHaveLength(1);
  });

  it("collapses the same label from two boards with different keys", () => {
    const m = mergeChartSeries(
      [
        series({
          categories: [cat("a1", "Done", 2), cat("a2", "Working", 1)],
          total: 3,
        }),
        series({
          categories: [cat("b9", "Done", 3), cat("b8", "Blocked", 1)],
          total: 4,
        }),
      ],
      6,
    );
    expect(m.total).toBe(7);
    expect(m.categories.map((c) => [c.key, c.label, c.value])).toEqual([
      ["a1", "Done", 5], // first input's key wins — stable identity
      ["b8", "Blocked", 1],
      ["a2", "Working", 1],
    ]);
  });

  it("keeps __none and __other reserved keys and paints them neutral", () => {
    const m = mergeChartSeries(
      [
        series({
          categories: [cat("__none", "—", 2), cat("__other", "Other", 1)],
          total: 3,
        }),
        series({
          categories: [cat("__none", "—", 3), cat("__other", "Other", 2)],
          total: 5,
        }),
      ],
      6,
    );
    expect(m.categories).toEqual([
      { key: "__none", label: "—", value: 5, color: PRINT_NEUTRAL },
      { key: "__other", label: "Other", value: 3, color: PRINT_NEUTRAL },
    ]);
  });

  it("keeps the reserved key when a board-local key shares the label", () => {
    const m = mergeChartSeries(
      [
        series({ categories: [cat("optX", "Other", 1)], total: 1 }),
        series({ categories: [cat("__other", "Other", 2)], total: 2 }),
      ],
      6,
    );
    expect(m.categories[0].key).toBe("__other");
    expect(m.categories[0].color).toBe(PRINT_NEUTRAL);
    expect(m.categories[0].value).toBe(3);
  });

  it("sorts by value desc then label asc", () => {
    const m = mergeChartSeries(
      [
        series({
          categories: [
            cat("k1", "Beta", 2),
            cat("k2", "Alpha", 2),
            cat("k3", "Gamma", 5),
          ],
          total: 9,
        }),
      ],
      6,
    );
    expect(m.categories.map((c) => c.label)).toEqual([
      "Gamma",
      "Alpha",
      "Beta",
    ]);
  });

  it("recolours from the print ramp by FINAL sorted index", () => {
    const m = mergeChartSeries(
      [
        series({
          categories: [
            cat("k1", "Alpha", 5, "#ff0000"),
            cat("k2", "Beta", 3, "#00ff00"),
            cat("k3", "Gamma", 1, "#0000ff"),
          ],
          total: 9,
        }),
      ],
      6,
    );
    expect(m.categories.map((c) => c.color)).toEqual([
      rampSlot(0),
      rampSlot(1),
      rampSlot(2),
    ]);
  });

  it("counts neutral categories in the final index when ramping", () => {
    const m = mergeChartSeries(
      [
        series({
          categories: [cat("__none", "—", 10), cat("k1", "Alpha", 5)],
          total: 15,
        }),
      ],
      6,
    );
    expect(m.categories[0].color).toBe(PRINT_NEUTRAL);
    expect(m.categories[1].color).toBe(rampSlot(1));
  });

  it("folds everything past maxCategories into a trailing Other", () => {
    const m = mergeChartSeries(
      [
        series({
          categories: [
            cat("k1", "A", 4),
            cat("k2", "B", 3),
            cat("k3", "C", 2),
            cat("k4", "D", 1),
          ],
          total: 10,
        }),
      ],
      2,
    );
    expect(m.categories).toEqual([
      { key: "k1", label: "A", value: 4, color: rampSlot(0) },
      { key: "k2", label: "B", value: 3, color: rampSlot(1) },
      { key: "__other", label: "Other", value: 3, color: PRINT_NEUTRAL },
    ]);
    expect(m.total).toBe(10);
  });

  it("folds a pre-existing Other into the trailing Other bucket", () => {
    const m = mergeChartSeries(
      [
        series({
          categories: [
            cat("k1", "A", 5),
            cat("__other", "Other", 4),
            cat("k3", "C", 3),
            cat("k4", "D", 2),
          ],
          total: 14,
        }),
      ],
      2,
    );
    expect(m.categories).toEqual([
      { key: "k1", label: "A", value: 5, color: rampSlot(0) },
      { key: "__other", label: "Other", value: 9, color: PRINT_NEUTRAL },
    ]);
  });

  it("does not fold when the category count fits maxCategories", () => {
    const m = mergeChartSeries(
      [
        series({
          categories: [cat("k1", "A", 2), cat("k2", "B", 1)],
          total: 3,
        }),
      ],
      2,
    );
    expect(m.categories.map((c) => c.key)).toEqual(["k1", "k2"]);
  });

  it("takes categoryName from the first non-empty input even if they disagree", () => {
    const m = mergeChartSeries(
      [
        { ...EMPTY_SERIES, categoryName: "Ignored" },
        series({
          categories: [cat("k1", "A", 1)],
          total: 1,
          categoryName: "Status",
        }),
        series({
          categories: [cat("k2", "B", 1)],
          total: 1,
          categoryName: "Priority",
        }),
      ],
      6,
    );
    expect(m.categoryName).toBe("Status");
  });
});
