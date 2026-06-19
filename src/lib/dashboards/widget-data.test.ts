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
