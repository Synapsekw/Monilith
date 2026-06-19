import { describe, expect, it } from "vitest";
import { rollupCell } from "./rollup";

describe("rollupCell", () => {
  it("returns blank when no values are present", () => {
    expect(rollupCell("numbers", [null, undefined]).kind).toBe("blank");
  });

  it("sums numbers", () => {
    const r = rollupCell("numbers", [{ n: 5 }, { n: 8 }, null]);
    expect(r).toEqual({ kind: "number", total: 13 });
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
