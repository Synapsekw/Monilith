import { describe, expect, it, vi } from "vitest";
import {
  MAX_BURN_STAGES,
  MAX_BURN_WEEKS,
  MAX_LOAD_ROWS,
  burnRowsOf,
  parseBurnPacked,
  unpackBurnPacked,
  unpackLoadPacked,
} from "./packed";
import { addDays } from "./tower";
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
    [
      `more than ${MAX_BURN_WEEKS} weeks between lo and hi`,
      { ...burn, lo: "2026-01-05", hi: addDays("2026-01-05", 105 * 7) },
    ],
    [
      `more than ${MAX_BURN_STAGES} stages`,
      {
        ...burn,
        stages: Array.from({ length: MAX_BURN_STAGES + 1 }, (_, i) => `s${i}`),
      },
    ],
    [
      "more rows than stages x weeks",
      {
        lo: "2026-10-26",
        hi: "2026-10-26",
        stages: ["s"],
        rows: [
          [0, 0, 1, 0, 0, 0],
          [0, 0, 2, 0, 0, 0],
        ],
      },
    ],
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

  it("turns rows into LoadRow objects in order and keeps the server's weeks", () => {
    expect(unpackLoadPacked(load)).toEqual({
      ok: true,
      weeks: load.weeks,
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
      `more than ${MAX_LOAD_ROWS} rows`,
      {
        ...load,
        rows: Array.from({ length: MAX_LOAD_ROWS + 1 }, (_, i) => [
          `b${i}`,
          "build",
          "2026-10-19",
          1,
        ]),
      },
    ],
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

describe("the packed burn bounds", () => {
  it(`accepts exactly ${MAX_BURN_WEEKS} weeks between lo and hi`, () => {
    const hi = addDays("2026-01-05", MAX_BURN_WEEKS * 7);
    const res = unpackBurnPacked({
      lo: "2026-01-05",
      hi,
      stages: ["s"],
      rows: [],
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.rows).toHaveLength(MAX_BURN_WEEKS + 1);
  });
});

describe("parseBurnPacked and burnRowsOf (server validates, client expands)", () => {
  it("returns the packed value untouched on the server", () => {
    expect(parseBurnPacked(burn)).toEqual({ ok: true, packed: burn });
  });

  it("expands on the client to the same rows the dense unpack gives", () => {
    const parsed = parseBurnPacked(burn);
    if (!parsed.ok) throw new Error(parsed.error);
    const dense = unpackBurnPacked(burn);
    if (!dense.ok) throw new Error(dense.error);
    expect(burnRowsOf(parsed.packed)).toEqual(dense.rows);
  });

  it("gives null for a missing or malformed packed value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(burnRowsOf(null)).toBeNull();
    expect(
      burnRowsOf({ ...burn, rows: [[9, 0, 1, 0, 0, 0]] } as never),
    ).toBeNull();
    spy.mockRestore();
  });
});

/**
 * Payload size for a 59-stage x 73-week folder (the brief's reference size).
 * Each stage is planned over 6 weeks, completes in 3 of them and stays
 * overdue from its due weeks until the current week (week 50): a dense,
 * realistic spread of non-zero cells.
 */
function bigFolder() {
  const stages = Array.from(
    { length: 59 },
    (_, i) => `stage-${String(i).padStart(2, "0")}-${"x".repeat(12)}`,
  );
  const rows: [number, number, number, number, number, number][] = [];
  for (let si = 0; si < 59; si++) {
    const due = 5 + (si % 40);
    for (let wo = 0; wo < 73; wo++) {
      const planned = wo >= due && wo < due + 6 ? 3 : 0;
      const completed = wo >= due + 1 && wo < due + 4 ? 2 : 0;
      const overdue = wo > due && wo <= 50 ? 1 + (wo % 5) : 0;
      if (planned + completed + overdue > 0)
        rows.push([si, wo, planned, completed, 0, overdue]);
    }
  }
  return {
    lo: "2025-08-25",
    hi: addDays("2025-08-25", 72 * 7),
    stages,
    rows,
  };
}

describe("payload bytes for a 59-stage x 73-week folder", () => {
  it("ships the packed value at a small fraction of the dense rows", () => {
    const packed = bigFolder();
    const dense = unpackBurnPacked(packed);
    if (!dense.ok) throw new Error(dense.error);
    expect(dense.rows).toHaveLength(59 * 73);
    const before = JSON.stringify(dense.rows).length;
    const after = JSON.stringify(packed).length;
    // Worst case: every one of the 4,307 cells non-zero.
    const full = {
      ...packed,
      rows: Array.from({ length: 59 * 73 }, (_, k) => [
        Math.floor(k / 73),
        k % 73,
        12,
        11,
        10,
        9,
      ]),
    };
    const worst = JSON.stringify(full).length;
    // Measured 2026-11-15: dense 521,148 B; packed 29,236 B (1,763 cells);
    // packed worst case 81,986 B.
    expect(after).toBeLessThan(before / 5);
    expect(worst).toBeLessThan(before / 3);
  });
});
