import { describe, expect, it } from "vitest";
import { aggregate, allowedAggregations, COUNT_FAMILY } from "./aggregation";
import type { ColumnKind } from "@/lib/validations/boards";

const ALL_KINDS: ColumnKind[] = [
  "text",
  "status",
  "people",
  "date",
  "numbers",
  "dropdown",
  "checkbox",
  "rating",
  "link",
  "email",
  "phone",
  "files",
  "time_tracking",
  "relation",
  "mirror",
  "percent",
];

describe("allowedAggregations", () => {
  it("offers the count family on every kind", () => {
    for (const kind of ALL_KINDS) {
      const allowed = allowedAggregations(
        kind,
        kind === "mirror" ? "numbers" : undefined,
      );
      for (const c of COUNT_FAMILY) {
        expect(allowed, `${kind} should allow ${c}`).toContain(c);
      }
    }
  });

  it("puts the sensible default first", () => {
    expect(allowedAggregations("numbers")[0]).toBe("sum");
    expect(allowedAggregations("rating")[0]).toBe("avg");
    expect(allowedAggregations("status")[0]).toBe("distribution");
    expect(allowedAggregations("dropdown")[0]).toBe("distribution");
    expect(allowedAggregations("checkbox")[0]).toBe("checked_total");
    expect(allowedAggregations("date")[0]).toBe("date_range");
    expect(allowedAggregations("people")[0]).toBe("count_unique");
    expect(allowedAggregations("time_tracking")[0]).toBe("total_tracked");
    expect(allowedAggregations("files")[0]).toBe("count_filled");
    expect(allowedAggregations("relation")[0]).toBe("count_filled");
    expect(allowedAggregations("text")[0]).toBe("count");
  });

  it("only offers the count family for free-text kinds", () => {
    for (const kind of ["text", "link", "email", "phone"] as ColumnKind[]) {
      expect(allowedAggregations(kind)).toEqual([...COUNT_FAMILY]);
    }
  });

  it("percent defaults to avg and exposes the numeric aggregations", () => {
    const allowed = allowedAggregations("percent");
    expect(allowed[0]).toBe("avg");
    expect(allowed).toContain("min");
    expect(allowed).toContain("max");
  });

  it("numbers exposes the numeric aggregations", () => {
    const allowed = allowedAggregations("numbers");
    expect(allowed).toContain("sum");
    expect(allowed).toContain("avg");
    expect(allowed).toContain("min");
    expect(allowed).toContain("max");
  });

  it("mirror delegates to the target column's kind", () => {
    expect(allowedAggregations("mirror", "numbers")).toEqual(
      allowedAggregations("numbers"),
    );
    expect(allowedAggregations("mirror", "status")).toEqual(
      allowedAggregations("status"),
    );
  });

  it("mirror falls back to the count family without a target", () => {
    expect(allowedAggregations("mirror")).toEqual([...COUNT_FAMILY]);
  });

  it("mirror does not recurse on a mirror target", () => {
    expect(allowedAggregations("mirror", "mirror")).toEqual([...COUNT_FAMILY]);
  });
});

describe("aggregate", () => {
  const nums = [{ n: 10 }, { n: 5 }, null, { n: 15 }];

  it("count family counts presence", () => {
    expect(aggregate("numbers", "count", nums)).toEqual({
      kind: "number",
      value: 4,
    });
    expect(aggregate("numbers", "count_filled", nums)).toEqual({
      kind: "number",
      value: 3,
    });
    expect(aggregate("numbers", "count_empty", nums)).toEqual({
      kind: "number",
      value: 1,
    });
  });

  it("count_unique dedupes, flattening people", () => {
    const people = [{ userIds: ["a", "b"] }, { userIds: ["b"] }, null];
    expect(aggregate("people", "count_unique", people)).toEqual({
      kind: "number",
      value: 2,
    });
    expect(
      aggregate("text", "count_unique", [{ text: "x" }, { text: "x" }]),
    ).toEqual({ kind: "number", value: 1 });
  });

  it("sum/avg/min/max over numbers", () => {
    expect(aggregate("numbers", "sum", nums)).toEqual({
      kind: "number",
      value: 30,
    });
    expect(aggregate("numbers", "avg", nums)).toEqual({
      kind: "number",
      value: 10,
    });
    expect(aggregate("numbers", "min", nums)).toEqual({
      kind: "number",
      value: 5,
    });
    expect(aggregate("numbers", "max", nums)).toEqual({
      kind: "number",
      value: 15,
    });
  });

  it("avg rounds to two decimals", () => {
    const r = aggregate("numbers", "avg", [{ n: 1 }, { n: 2 }]);
    expect(r).toEqual({ kind: "number", value: 1.5 });
  });

  it("averages a percent column with a percent style", () => {
    const pcts = [{ percent: 100 }, { percent: 50 }, null];
    expect(aggregate("percent", "avg", pcts)).toEqual({
      kind: "number",
      value: 75,
      style: "percent",
    });
  });

  it("numeric aggs are empty when nothing is filled", () => {
    expect(aggregate("numbers", "sum", [null, null])).toEqual({
      kind: "empty",
    });
  });

  it("checked_total and percent_checked over checkboxes", () => {
    const boxes = [
      { checked: true },
      { checked: false },
      { checked: true },
      null,
    ];
    expect(aggregate("checkbox", "checked_total", boxes)).toEqual({
      kind: "checkbox",
      checked: 2,
      total: 3,
    });
    expect(aggregate("checkbox", "percent_checked", boxes)).toEqual({
      kind: "number",
      value: 67,
      style: "percent",
    });
  });

  it("status distribution reuses the rollup engine with options", () => {
    const options = [
      { id: "d", label: "Done", color: "#0f0" },
      { id: "w", label: "WIP", color: "#ff0" },
    ];
    const r = aggregate(
      "status",
      "distribution",
      [{ optionId: "d" }, { optionId: "d" }, { optionId: "w" }, null],
      options,
    );
    expect(r.kind).toBe("distribution");
    if (r.kind === "distribution") {
      expect(r.total).toBe(3);
      expect(r.segments[0]).toMatchObject({ id: "d", count: 2, label: "Done" });
    }
  });

  it("date range / earliest / latest", () => {
    const dates = [
      { date: "2026-03-01" },
      { date: "2026-01-15", end: "2026-06-30" },
      null,
    ];
    expect(aggregate("date", "date_range", dates)).toEqual({
      kind: "dateSpan",
      start: "2026-01-15",
      end: "2026-06-30",
    });
    expect(aggregate("date", "earliest", dates)).toEqual({
      kind: "date",
      date: "2026-01-15",
    });
    expect(aggregate("date", "latest", dates)).toEqual({
      kind: "date",
      date: "2026-06-30",
    });
  });

  it("time tracking totals (pre-reduced trackedSecs/estimateSecs)", () => {
    const tt = [
      { trackedSecs: 3600, estimateSecs: 7200 },
      { trackedSecs: 1800 },
      null,
    ];
    expect(aggregate("time_tracking", "total_tracked", tt)).toEqual({
      kind: "duration",
      totalSecs: 5400,
    });
    expect(aggregate("time_tracking", "total_over_estimate", tt)).toEqual({
      kind: "duration",
      totalSecs: 5400,
      estimateSecs: 7200,
    });
  });

  it("empty input yields an empty result", () => {
    expect(aggregate("numbers", "sum", [])).toEqual({ kind: "empty" });
    expect(aggregate("status", "distribution", [])).toEqual({ kind: "empty" });
  });
});

describe("currency aggregation", () => {
  const vals = [{ amount: 10.5 }, { amount: 20 }, null, { amount: -5 }];
  it("offers sum-first numeric aggregations", () => {
    expect(allowedAggregations("currency")).toEqual([
      "sum",
      "avg",
      "min",
      "max",
      "count",
      "count_filled",
      "count_empty",
      "count_unique",
    ]);
  });
  it("sums amounts and carries the currency style", () => {
    expect(aggregate("currency", "sum", vals, undefined, "KWD")).toEqual({
      kind: "number",
      value: 25.5,
      style: "currency",
      currency: "KWD",
    });
  });
  it("counts filled cells by amount presence", () => {
    expect(aggregate("currency", "count_filled", vals)).toEqual({
      kind: "number",
      value: 3,
    });
  });
});
