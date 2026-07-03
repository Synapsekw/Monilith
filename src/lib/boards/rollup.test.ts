import { describe, expect, it } from "vitest";
import { rollupCell, rollupTimeTracking } from "./rollup";

describe("rollupCell", () => {
  it("returns blank when no values are present", () => {
    expect(rollupCell("numbers", [null, undefined]).kind).toBe("blank");
  });

  it("sums numbers", () => {
    const r = rollupCell("numbers", [{ n: 5 }, { n: 8 }, null]);
    expect(r).toEqual({ kind: "number", total: 13 });
  });

  it("averages percent subitems, ignoring empty cells", () => {
    const r = rollupCell("percent", [{ percent: 100 }, { percent: 50 }, null]);
    expect(r).toEqual({ kind: "percent", average: 75 });
  });

  it("rounds the percent average to a whole number", () => {
    const r = rollupCell("percent", [{ percent: 33 }, { percent: 34 }]);
    expect(r).toEqual({ kind: "percent", average: 34 });
  });

  it("returns blank for a percent column with no filled subitems", () => {
    expect(rollupCell("percent", [null, undefined]).kind).toBe("blank");
  });

  it("builds a status distribution sorted by count, with option meta", () => {
    const options = [
      { id: "done", label: "Done", color: "#0f0" },
      { id: "wip", label: "WIP", color: "#ff0" },
    ];
    const r = rollupCell(
      "status",
      [
        { optionId: "done" },
        { optionId: "done" },
        { optionId: "wip" },
        { optionId: null },
      ],
      options,
    );
    expect(r.kind).toBe("distribution");
    if (r.kind === "distribution") {
      expect(r.total).toBe(3);
      expect(r.segments[0]).toEqual({
        id: "done",
        label: "Done",
        color: "#0f0",
        count: 2,
      });
    }
  });

  it("counts every dropdown selection", () => {
    const r = rollupCell(
      "dropdown",
      [{ optionIds: ["a", "b"] }, { optionIds: ["a"] }],
      [
        { id: "a", label: "A", color: "#111" },
        { id: "b", label: "B", color: "#222" },
      ],
    );
    expect(r.kind === "distribution" && r.total).toBe(3);
  });

  it("computes a date span across date + end", () => {
    const r = rollupCell("date", [
      { date: "2026-06-05" },
      { date: "2026-06-03", end: "2026-06-14" },
    ]);
    expect(r).toEqual({
      kind: "dateSpan",
      start: "2026-06-03",
      end: "2026-06-14",
    });
  });

  it("dedupes the people union count", () => {
    const r = rollupCell("people", [
      { userIds: ["u1", "u2"] },
      { userIds: ["u2", "u3"] },
    ]);
    expect(r).toEqual({ kind: "people", count: 3 });
  });

  it("is blank for text", () => {
    expect(rollupCell("text", [{ text: "hi" }]).kind).toBe("blank");
  });
});

it("sums child tracked totals + estimates into a duration rollup", () => {
  const now = Date.UTC(2026, 5, 20, 12, 0, 0);
  const r = rollupTimeTracking(
    [
      { started_at: "x", ended_at: "y", duration_secs: 3600 },
      { started_at: "x", ended_at: "y", duration_secs: 1800 },
    ],
    [7200],
    now,
  );
  expect(r).toEqual({ kind: "duration", totalSecs: 5400, estimateSecs: 7200 });
});
it("returns blank when both tracked and estimate are zero", () => {
  const r = rollupTimeTracking([], [], Date.now());
  expect(r).toEqual({ kind: "blank" });
});
it("omits estimateSecs when no estimates provided", () => {
  const r = rollupTimeTracking(
    [{ started_at: "x", ended_at: "y", duration_secs: 1800 }],
    [],
    Date.now(),
  );
  expect(r).toEqual({ kind: "duration", totalSecs: 1800 });
});

describe("currency rollup", () => {
  it("sums subitem amounts with the column currency", () => {
    expect(
      rollupCell(
        "currency",
        [{ amount: 1.5 }, null, { amount: 2 }],
        undefined,
        "USD",
      ),
    ).toEqual({ kind: "currency", total: 3.5, currency: "USD" });
  });
  it("blanks when no filled amounts", () => {
    expect(rollupCell("currency", [null, {}], undefined, "USD")).toEqual({
      kind: "blank",
    });
  });
});

describe("priority rollup", () => {
  it("rolls priority up as a fixed-segment distribution", () => {
    const r = rollupCell("priority", [
      { level: "critical" },
      { level: "critical" },
      { level: "normal" },
    ]);
    expect(r).toEqual({
      kind: "distribution",
      total: 3,
      segments: [
        { id: "critical", label: "Critical", color: "#e2445c", count: 2 },
        { id: "normal", label: "Normal", color: "#c4c4c4", count: 1 },
      ],
    });
  });
  it("blanks when no stored levels", () => {
    expect(rollupCell("priority", [null, {}])).toEqual({ kind: "blank" });
  });
});
