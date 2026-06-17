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
