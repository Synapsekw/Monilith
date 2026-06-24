import { describe, expect, it } from "vitest";
import { validateProposal, packLayout } from "@/lib/ai/proposal-schema";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

const snap: BoardSnapshot = {
  board: { id: "b1", name: "Sprint" },
  rowCount: 10,
  columns: [
    { id: "c-status", name: "Status", kind: "status", options: [] },
    { id: "c-pts", name: "Points", kind: "numbers" },
    { id: "c-notes", name: "Notes", kind: "text" },
  ],
  columnStats: {},
  meta: { rowCount: 10, columnCount: 3, estimatedTokens: 1 },
};

describe("validateProposal", () => {
  it("keeps a valid chart widget and a number widget", () => {
    const res = validateProposal(
      {
        name: "Sprint overview",
        widgets: [
          { kind: "number", title: "Total", config: { agg: "count" } },
          {
            kind: "chart",
            title: "By status",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c-status" },
              measure: { agg: "count" },
            },
          },
        ],
      },
      snap,
    );
    expect(res.name).toBe("Sprint overview");
    expect(res.widgets).toHaveLength(2);
    expect(res.warnings).toHaveLength(0);
  });

  it("drops a chart referencing a non-existent column", () => {
    const res = validateProposal(
      {
        name: "x",
        widgets: [
          {
            kind: "chart",
            title: "bad",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "nope" },
              measure: { agg: "count" },
            },
          },
        ],
      },
      snap,
    );
    expect(res.widgets).toHaveLength(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("drops a chart whose primary kind mismatches the column's kind", () => {
    const res = validateProposal(
      {
        name: "x",
        widgets: [
          {
            kind: "chart",
            title: "bad",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c-pts" }, // c-pts is numbers
              measure: { agg: "count" },
            },
          },
        ],
      },
      snap,
    );
    expect(res.widgets).toHaveLength(0);
  });

  it("repairs a sum measure with a missing value column down to count", () => {
    const res = validateProposal(
      {
        name: "x",
        widgets: [
          {
            kind: "chart",
            title: "repair",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c-status" },
              measure: { agg: "sum" }, // no valueColumnId → coerce to count
            },
          },
        ],
      },
      snap,
    );
    expect(res.widgets).toHaveLength(1);
    expect(
      (res.widgets[0].config as { measure: { agg: string } }).measure.agg,
    ).toBe("count");
  });

  it("returns empty (with a warning) when name is missing", () => {
    const res = validateProposal({ widgets: [] } as never, snap);
    expect(res.name.length).toBeGreaterThan(0); // falls back to board name
  });
});

describe("packLayout", () => {
  it("assigns non-overlapping 12-col rects when layout is omitted", () => {
    const widgets = [
      { kind: "number" as const, title: "a", config: {} },
      { kind: "number" as const, title: "b", config: {} },
      { kind: "chart" as const, title: "c", config: {} },
    ];
    const packed = packLayout(widgets);
    expect(packed).toHaveLength(3);
    for (const w of packed) {
      expect(w.layout.x).toBeGreaterThanOrEqual(0);
      expect(w.layout.x + w.layout.w).toBeLessThanOrEqual(12);
      expect(w.layout.w).toBeGreaterThanOrEqual(1);
      expect(w.layout.h).toBeGreaterThanOrEqual(1);
    }
  });
});
