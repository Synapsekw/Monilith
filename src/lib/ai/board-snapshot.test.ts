import { describe, expect, it } from "vitest";
import { buildBoardSnapshot } from "@/lib/ai/board-snapshot";

const board = { id: "b1", name: "Sprint" };
const columns = [
  {
    id: "c-status",
    name: "Status",
    kind: "status",
    settings: {
      options: [
        { id: "o-todo", label: "To Do", color: "#1" },
        { id: "o-done", label: "Done", color: "#2" },
      ],
    },
  },
  { id: "c-pts", name: "Points", kind: "numbers", settings: {} },
  { id: "c-notes", name: "Notes", kind: "text", settings: {} },
] as const;
const items = [{ id: "i1" }, { id: "i2" }, { id: "i3" }];
const cellValues = [
  { item_id: "i1", column_id: "c-status", value: { optionId: "o-todo" } },
  { item_id: "i2", column_id: "c-status", value: { optionId: "o-done" } },
  { item_id: "i3", column_id: "c-status", value: { optionId: "o-done" } },
  { item_id: "i1", column_id: "c-pts", value: { n: 2 } },
  { item_id: "i2", column_id: "c-pts", value: { n: 8 } },
  // i3 points empty
];

describe("buildBoardSnapshot", () => {
  const snap = buildBoardSnapshot({
    board,
    columns: columns as never,
    items,
    cellValues,
  });

  it("includes board, rowCount, and column metadata", () => {
    expect(snap.board).toEqual({ id: "b1", name: "Sprint" });
    expect(snap.rowCount).toBe(3);
    const status = snap.columns.find((c) => c.id === "c-status");
    expect(status?.kind).toBe("status");
    expect(status?.options).toEqual([
      { id: "o-todo", label: "To Do" },
      { id: "o-done", label: "Done" },
    ]);
  });

  it("computes status distribution from cell values, never exposing rows", () => {
    const stats = snap.columnStats["c-status"];
    expect(stats.fillRate).toBe(1);
    expect(stats.distribution).toEqual(
      expect.arrayContaining([
        { label: "Done", count: 2 },
        { label: "To Do", count: 1 },
      ]),
    );
    // no per-item data anywhere in the snapshot
    expect(JSON.stringify(snap)).not.toContain("i1");
  });

  it("computes numeric stats and fill rate", () => {
    const stats = snap.columnStats["c-pts"];
    expect(stats.fillRate).toBeCloseTo(2 / 3);
    expect(stats.numeric).toEqual({ min: 2, max: 8, avg: 5, sum: 10 });
  });

  it("reports text columns as fill-rate only (no values)", () => {
    const stats = snap.columnStats["c-notes"];
    expect(stats.fillRate).toBe(0);
    expect(stats.numeric).toBeUndefined();
    expect(stats.distribution).toBeUndefined();
  });

  it("estimates token size and column count in meta", () => {
    expect(snap.meta.columnCount).toBe(3);
    expect(snap.meta.rowCount).toBe(3);
    expect(snap.meta.estimatedTokens).toBeGreaterThan(0);
  });
});
