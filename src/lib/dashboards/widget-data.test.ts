import { describe, expect, it } from "vitest";
import { configHash, formatMetric, numberFromBuckets } from "./widget-data";

describe("configHash", () => {
  it("is stable regardless of key order", () => {
    expect(configHash({ a: 1, b: 2 })).toBe(configHash({ b: 2, a: 1 }));
  });
  it("differs when values differ", () => {
    expect(configHash({ agg: "count" })).not.toBe(configHash({ agg: "sum" }));
  });
});

describe("numberFromBuckets", () => {
  it("sums all bucket metrics into a single scalar", () => {
    expect(numberFromBuckets([{ group_key: null, metric: 5 }])).toBe(5);
    expect(
      numberFromBuckets([
        { group_key: "a", metric: 2 },
        { group_key: "b", metric: 3 },
      ]),
    ).toBe(5);
  });
  it("returns 0 for no buckets", () => {
    expect(numberFromBuckets([])).toBe(0);
  });
});

describe("formatMetric", () => {
  it("formats whole numbers without decimals", () => {
    expect(formatMetric(42, "count")).toBe("42");
  });
  it("rounds avg to one decimal", () => {
    expect(formatMetric(3.333, "avg")).toBe("3.3");
  });
});

import { bucketsTotal, shapeBuckets, type ColumnMeta } from "./widget-data";

const meta: ColumnMeta = {
  kind: "status",
  options: [
    { id: "o1", label: "Working on it", color: "#fdab3d" },
    { id: "o2", label: "Done", color: "#00c875" },
  ],
};

describe("shapeBuckets", () => {
  it("resolves optionId buckets to label+color in option order", () => {
    const rows = shapeBuckets(
      [
        { group_key: "o2", metric: 3 },
        { group_key: "o1", metric: 5 },
      ],
      meta,
    );
    expect(rows.map((r) => [r.label, r.count, r.color])).toEqual([
      ["Working on it", 5, "#fdab3d"],
      ["Done", 3, "#00c875"],
    ]);
  });

  it("adds a trailing 'None' bucket for the null group key", () => {
    const rows = shapeBuckets([{ group_key: null, metric: 2 }], meta);
    expect(rows.at(-1)).toMatchObject({ key: null, label: "None", count: 2 });
  });

  it("includes zero-count options and labels unknown ids", () => {
    const rows = shapeBuckets([{ group_key: "ghost", metric: 1 }], meta);
    // both known options appear with 0, plus the unknown id
    expect(rows.find((r) => r.label === "Working on it")?.count).toBe(0);
    expect(rows.find((r) => r.label === "Done")?.count).toBe(0);
    expect(rows.find((r) => r.label === "Unknown")?.count).toBe(1);
  });
});

describe("bucketsTotal", () => {
  it("sums metrics", () => {
    expect(
      bucketsTotal([
        { group_key: "o1", metric: 5 },
        { group_key: null, metric: 2 },
      ]),
    ).toBe(7);
  });
});

import { shapeCompletion } from "./widget-data";

describe("shapeCompletion", () => {
  const groups = [
    { id: "g1", label: "Workstream A", color: "#0073ea" },
    { id: "g2", label: "Workstream B", color: "#00c875" },
    { id: "g3", label: "Empty group", color: "#999999" },
  ];

  it("emits one row per group in position order, weighted overall", () => {
    const shaped = shapeCompletion(
      [
        { groupKey: "g2", itemCount: 1, completion: 100 },
        { groupKey: "g1", itemCount: 3, completion: 50 },
      ],
      groups,
    );
    expect(shaped.rows.map((r) => r.key)).toEqual(["g1", "g2", "g3"]);
    expect(shaped.rows[0]).toMatchObject({ percent: 50, itemCount: 3 });
    expect(shaped.rows[2]).toMatchObject({ percent: null, itemCount: 0 });
    // weighted: (50*3 + 100*1) / 4 = 62.5 — never the unweighted mean (75)
    expect(shaped.overall).toBe(62.5);
    expect(shaped.totalItems).toBe(4);
  });

  it("folds unknown group keys into a trailing Unknown row", () => {
    const shaped = shapeCompletion(
      [
        { groupKey: "g1", itemCount: 2, completion: 100 },
        { groupKey: "deleted-group", itemCount: 2, completion: 0 },
      ],
      groups.slice(0, 1),
    );
    const last = shaped.rows[shaped.rows.length - 1];
    expect(last.label).toBe("Unknown");
    expect(last.percent).toBe(0);
    expect(shaped.overall).toBe(50);
  });

  it("returns null overall for an empty board", () => {
    const shaped = shapeCompletion([], groups);
    expect(shaped.overall).toBeNull();
    expect(shaped.totalItems).toBe(0);
    expect(shaped.rows.every((r) => r.percent === null)).toBe(true);
  });
});

import { shapeHealth } from "./widget-data";

describe("shapeHealth", () => {
  it("computes progress as done/total", () => {
    const shaped = shapeHealth({
      totalItems: 8,
      doneItems: 2,
      overdueItems: 3,
      incompleteItems: 4,
      newItems7d: 1,
    });
    expect(shaped.progress).toBe(25);
    expect(shaped.counts.overdueItems).toBe(3);
  });

  it("returns null progress for an empty board", () => {
    const shaped = shapeHealth({
      totalItems: 0,
      doneItems: 0,
      overdueItems: 0,
      incompleteItems: 0,
      newItems7d: 0,
    });
    expect(shaped.progress).toBeNull();
  });
});
