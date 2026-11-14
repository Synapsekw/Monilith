import { describe, expect, it, vi } from "vitest";
import { unpackBurnPacked, unpackLoadPacked } from "./packed";
import { FOLDER_DATA_ERROR } from "./types";

const burn = {
  lo: "2026-10-26",
  hi: "2026-11-09",
  stages: ["build", "qa"],
  rows: [
    [0, 0, 2, 1, 0, 0],
    [0, 2, 3, 0, 0, 4],
    [1, 1, 0, 5, 5, 0],
  ],
};

describe("unpackBurnPacked", () => {
  it("rebuilds the dense stage x week grid, zero-filling missing weeks", () => {
    const res = unpackBurnPacked(burn);
    if (!res.ok) throw new Error(res.error);
    expect(res.rows).toEqual([
      {
        stageKey: "build",
        weekStart: "2026-10-26",
        planned: 2,
        completed: 1,
        importedDone: 0,
        overdueOpen: 0,
      },
      {
        stageKey: "build",
        weekStart: "2026-11-02",
        planned: 0,
        completed: 0,
        importedDone: 0,
        overdueOpen: 0,
      },
      {
        stageKey: "build",
        weekStart: "2026-11-09",
        planned: 3,
        completed: 0,
        importedDone: 0,
        overdueOpen: 4,
      },
      {
        stageKey: "qa",
        weekStart: "2026-10-26",
        planned: 0,
        completed: 0,
        importedDone: 0,
        overdueOpen: 0,
      },
      {
        stageKey: "qa",
        weekStart: "2026-11-02",
        planned: 0,
        completed: 5,
        importedDone: 5,
        overdueOpen: 0,
      },
      {
        stageKey: "qa",
        weekStart: "2026-11-09",
        planned: 0,
        completed: 0,
        importedDone: 0,
        overdueOpen: 0,
      },
    ]);
  });

  it("returns no rows for a folder with no events", () => {
    expect(
      unpackBurnPacked({ lo: null, hi: null, stages: [], rows: [] }),
    ).toEqual({ ok: true, rows: [] });
  });

  it("crosses a year boundary in whole weeks", () => {
    const res = unpackBurnPacked({
      lo: "2026-12-28",
      hi: "2027-01-04",
      stages: ["s"],
      rows: [[0, 1, 1, 0, 0, 0]],
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.rows.map((r) => [r.weekStart, r.planned])).toEqual([
      ["2026-12-28", 0],
      ["2027-01-04", 1],
    ]);
  });

  it.each([
    ["not an object", 42],
    ["a missing key", { lo: "2026-10-26", hi: "2026-11-09", stages: [] }],
    ["a short row", { ...burn, rows: [[0, 0, 1]] }],
    ["a fractional count", { ...burn, rows: [[0, 0, 1.5, 0, 0, 0]] }],
    ["a negative count", { ...burn, rows: [[0, 0, -1, 0, 0, 0]] }],
    ["an unknown stage index", { ...burn, rows: [[2, 0, 1, 0, 0, 0]] }],
    ["a week past hi", { ...burn, rows: [[0, 3, 1, 0, 0, 0]] }],
    [
      "a repeated cell",
      {
        ...burn,
        rows: [
          [0, 0, 1, 0, 0, 0],
          [0, 0, 2, 0, 0, 0],
        ],
      },
    ],
    ["a repeated stage", { ...burn, stages: ["build", "build"] }],
    ["hi before lo", { ...burn, lo: "2026-11-09", hi: "2026-10-26" }],
    ["a window that is not whole weeks", { ...burn, hi: "2026-11-10" }],
    ["only one bound", { ...burn, hi: null }],
    [
      "rows without a window",
      { lo: null, hi: null, stages: ["s"], rows: [[0, 0, 1, 0, 0, 0]] },
    ],
    ["a bad date", { ...burn, lo: "26-10-2026" }],
  ])("fails closed on %s", (_label, value) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(unpackBurnPacked(value)).toEqual({
      ok: false,
      error: FOLDER_DATA_ERROR,
    });
    spy.mockRestore();
  });
});

describe("unpackLoadPacked", () => {
  const load = {
    weeks: [
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ],
    rows: [
      ["b1", "build", "2026-10-19", 5],
      ["b1", "qa", "2026-11-09", 2],
      ["b2", "build", "2026-11-16", 4],
    ],
  };

  it("turns rows into LoadRow objects in order", () => {
    expect(unpackLoadPacked(load)).toEqual({
      ok: true,
      rows: [
        {
          boardId: "b1",
          stageKey: "build",
          weekStart: "2026-10-19",
          openDue: 5,
        },
        { boardId: "b1", stageKey: "qa", weekStart: "2026-11-09", openDue: 2 },
        {
          boardId: "b2",
          stageKey: "build",
          weekStart: "2026-11-16",
          openDue: 4,
        },
      ],
    });
  });

  it.each([
    ["not an object", "x"],
    ["a missing weeks list", { rows: [] }],
    ["a row of the wrong arity", { ...load, rows: [["b1", "build", 5]] }],
    [
      "a week outside the window",
      { ...load, rows: [["b1", "build", "2026-12-07", 1]] },
    ],
    ["a zero cell", { ...load, rows: [["b1", "build", "2026-10-19", 0]] }],
    [
      "a repeated cell",
      {
        ...load,
        rows: [
          ["b1", "build", "2026-10-19", 1],
          ["b1", "build", "2026-10-19", 2],
        ],
      },
    ],
  ])("fails closed on %s", (_label, value) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(unpackLoadPacked(value)).toEqual({
      ok: false,
      error: FOLDER_DATA_ERROR,
    });
    spy.mockRestore();
  });
});
