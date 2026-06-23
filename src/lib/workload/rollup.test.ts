import { describe, expect, it } from "vitest";
import {
  spreadItemEffort,
  bucketByWeek,
  buildWindow,
  capacityState,
  buildWorkloadGrid,
  filterByBoards,
  foldActualRows,
  varianceSecs,
  variancePct,
  varianceState,
  actualsForCell,
} from "@/lib/workload/rollup";
import type {
  MemberCapacity,
  WorkloadActualRow,
  WorkloadMember,
  WorkloadRawRow,
} from "@/lib/workload/types";

const H = 3600;

describe("spreadItemEffort", () => {
  it("puts all effort on a single working day", () => {
    const m = spreadItemEffort(
      "2026-06-01",
      "2026-06-01",
      8 * H,
      [1, 2, 3, 4, 5],
    );
    expect(m.get("2026-06-01")).toBe(8 * H);
    expect([...m.keys()]).toHaveLength(1);
  });
  it("spreads evenly across working days, skipping the weekend", () => {
    // Mon 2026-06-01 .. Sun 2026-06-07 = 5 working days; Sat/Sun excluded
    const m = spreadItemEffort(
      "2026-06-01",
      "2026-06-07",
      10 * H,
      [1, 2, 3, 4, 5],
    );
    expect(m.get("2026-06-01")).toBeCloseTo(2 * H);
    expect(m.get("2026-06-05")).toBeCloseTo(2 * H);
    expect(m.has("2026-06-06")).toBe(false); // Saturday
    expect(m.has("2026-06-07")).toBe(false); // Sunday
  });
  it("falls back to the start day when the range has no working days", () => {
    // Sat..Sun with Mon-Fri mask → no working day; never drop effort
    const m = spreadItemEffort(
      "2026-06-06",
      "2026-06-07",
      4 * H,
      [1, 2, 3, 4, 5],
    );
    expect(m.get("2026-06-06")).toBe(4 * H);
  });
});

describe("bucketByWeek", () => {
  it("rolls per-day effort into Monday-start week buckets", () => {
    const perDay = new Map([
      ["2026-06-01", 2 * H], // Mon (week of Jun 1)
      ["2026-06-05", 2 * H], // Fri (same week)
      ["2026-06-08", 1 * H], // next Mon (week of Jun 8)
    ]);
    const b = bucketByWeek(perDay, 1);
    expect(b.get("2026-06-01")).toBe(4 * H);
    expect(b.get("2026-06-08")).toBe(1 * H);
  });
});

describe("buildWindow", () => {
  it("builds an ordered list of week buckets around today", () => {
    const w = buildWindow("2026-06-17", 1, 4, 1); // 1 back, 4 fwd, Mon start = 6 buckets
    expect(w).toHaveLength(6);
    expect(w[0].weekKey < w[5].weekKey).toBe(true);
    expect(w.every((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.weekKey))).toBe(true);
  });
});

describe("capacityState", () => {
  it("none when capacity is 0", () => {
    expect(capacityState(5 * H, 0)).toBe("none");
  });
  it("under / at / over thresholds", () => {
    expect(capacityState(10 * H, 40 * H)).toBe("under");
    expect(capacityState(40 * H, 40 * H)).toBe("at");
    expect(capacityState(50 * H, 40 * H)).toBe("over");
  });
});

describe("buildWorkloadGrid", () => {
  const members: WorkloadMember[] = [
    { userId: "u1", fullName: "Ann", email: null, avatarUrl: null },
  ];
  const caps: MemberCapacity[] = [
    {
      userId: "u1",
      hoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      customized: true,
    },
  ];
  const defaults = {
    hoursPerDay: 8,
    perItemHours: 4,
    workingDays: [1, 2, 3, 4, 5],
  };

  it("buckets an item's estimate into the right week for its assignee", () => {
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i1",
        boardId: "b1",
        itemName: "Task",
        userId: "u1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 8 * H,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    const cell = ann.cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cell.effortSecs).toBe(8 * H);
    expect(cell.capacitySecs).toBe(5 * 8 * H); // 5 working days × 8h
    expect(cell.state).toBe("under");
  });

  it("applies the per-item default when an item has no estimate", () => {
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i2",
        boardId: "b1",
        itemName: "No estimate",
        userId: "u1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: null,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    const cell = ann.cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cell.effortSecs).toBe(4 * H); // defaults.perItemHours
  });

  it("gives full effort to EACH of multiple assignees", () => {
    const members2: WorkloadMember[] = [
      { userId: "u1", fullName: "Ann", email: null, avatarUrl: null },
      { userId: "u2", fullName: "Bo", email: null, avatarUrl: null },
    ];
    const caps2: MemberCapacity[] = [
      {
        userId: "u1",
        hoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        customized: true,
      },
      {
        userId: "u2",
        hoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        customized: true,
      },
    ];
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i3",
        boardId: "b1",
        itemName: "Shared",
        userId: "u1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 6 * H,
      },
      {
        itemId: "i3",
        boardId: "b1",
        itemName: "Shared",
        userId: "u2",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 6 * H,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members2,
      caps2,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const cellOf = (uid: string) =>
      grid.rows
        .find((r) => r.userId === uid)!
        .cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cellOf("u1").effortSecs).toBe(6 * H);
    expect(cellOf("u2").effortSecs).toBe(6 * H);
  });

  it("collects unassigned items into a synthetic null-user row with capacity 0", () => {
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i4",
        boardId: "b1",
        itemName: "Orphan",
        userId: null,
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 4 * H,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const un = grid.rows.find((r) => r.userId === null)!;
    const cell = un.cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cell.effortSecs).toBe(4 * H);
    expect(cell.state).toBe("none"); // no capacity for the unassigned bucket
  });

  it("renders a zero-effort row for a member with no assignments", () => {
    const grid = buildWorkloadGrid(
      [],
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    expect(ann.totalEffortSecs).toBe(0);
    expect(ann.cells.every((c) => c.effortSecs === 0)).toBe(true);
  });

  it("uses org defaults for a member with no capacity row", () => {
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i5",
        boardId: "b1",
        itemName: "T",
        userId: "u1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 8 * H,
      },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members,
      [],
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    const cell = ann.cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cell.capacitySecs).toBe(5 * 8 * H); // from defaults
  });

  it("populates actualSecs on cells from logged time entries (v2)", () => {
    const rows: WorkloadRawRow[] = [
      {
        itemId: "i1",
        boardId: "b1",
        itemName: "Task",
        userId: "u1",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        estimateSecs: 8 * H,
      },
    ];
    const actuals: WorkloadActualRow[] = [
      { userId: "u1", boardId: "b1", day: "2026-06-02", secs: 3 * H },
      { userId: "u1", boardId: "b1", day: "2026-06-04", secs: 2 * H },
    ];
    const grid = buildWorkloadGrid(
      rows,
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
      actuals,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    const cell = ann.cells.find((c) => c.weekKey === "2026-06-01")!;
    expect(cell.actualSecs).toBe(5 * H); // both days fall in the week of Jun 1
    expect(ann.totalActualSecs).toBe(5 * H);
  });

  it("defaults actualSecs to 0 when no actuals are supplied", () => {
    const grid = buildWorkloadGrid(
      [],
      members,
      caps,
      defaults,
      "2026-06-17",
      4,
      4,
      1,
    );
    const ann = grid.rows.find((r) => r.userId === "u1")!;
    expect(ann.cells.every((c) => c.actualSecs === 0)).toBe(true);
    expect(ann.totalActualSecs).toBe(0);
  });
});

describe("filterByBoards", () => {
  const rows: WorkloadRawRow[] = [
    {
      itemId: "i1",
      boardId: "b1",
      itemName: "A",
      userId: "u1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      estimateSecs: null,
    },
    {
      itemId: "i2",
      boardId: "b2",
      itemName: "B",
      userId: "u1",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      estimateSecs: null,
    },
  ];

  it("returns all rows when the board set is null (no filter)", () => {
    expect(filterByBoards(rows, null)).toHaveLength(2);
  });
  it("subsets rows to the given board ids", () => {
    const out = filterByBoards(rows, new Set(["b1"]));
    expect(out).toHaveLength(1);
    expect(out[0].boardId).toBe("b1");
  });
  it("works for actual rows too (generic over boardId)", () => {
    const actuals: WorkloadActualRow[] = [
      { userId: "u1", boardId: "b1", day: "2026-06-02", secs: 3600 },
      { userId: "u1", boardId: "b2", day: "2026-06-02", secs: 3600 },
    ];
    expect(filterByBoards(actuals, new Set(["b2"]))).toEqual([
      { userId: "u1", boardId: "b2", day: "2026-06-02", secs: 3600 },
    ]);
  });
});

describe("foldActualRows", () => {
  it("folds day-granular actuals into per-user week buckets", () => {
    const actuals: WorkloadActualRow[] = [
      { userId: "u1", boardId: "b1", day: "2026-06-02", secs: 2 * H }, // wk of Jun 1
      { userId: "u1", boardId: "b1", day: "2026-06-05", secs: 1 * H }, // same wk
      { userId: "u1", boardId: "b1", day: "2026-06-08", secs: 4 * H }, // wk of Jun 8
      { userId: "u2", boardId: "b1", day: "2026-06-02", secs: 5 * H },
    ];
    const folded = foldActualRows(actuals, 1);
    expect(folded.get("u1")!.get("2026-06-01")).toBe(3 * H);
    expect(folded.get("u1")!.get("2026-06-08")).toBe(4 * H);
    expect(folded.get("u2")!.get("2026-06-01")).toBe(5 * H);
  });
});

describe("varianceSecs", () => {
  it("is signed: positive when over plan, negative when under", () => {
    expect(varianceSecs(10 * H, 6 * H)).toBe(4 * H); // logged 10h vs planned 6h
    expect(varianceSecs(4 * H, 6 * H)).toBe(-2 * H);
    expect(varianceSecs(6 * H, 6 * H)).toBe(0);
  });
});

describe("variancePct", () => {
  it("is the signed fraction of plan", () => {
    expect(variancePct(9 * H, 6 * H)).toBeCloseTo(0.5);
    expect(variancePct(3 * H, 6 * H)).toBeCloseTo(-0.5);
  });
  it("is null when there is no planned baseline (no divide-by-zero)", () => {
    expect(variancePct(4 * H, 0)).toBeNull();
  });
});

describe("varianceState", () => {
  it("reads neutral 'on' within the ±10% tolerance band", () => {
    expect(varianceState(6 * H, 6 * H)).toBe("on");
    expect(varianceState(6.5 * H, 6 * H)).toBe("on"); // +8.3%
  });
  it("reads over / under beyond the band", () => {
    expect(varianceState(9 * H, 6 * H)).toBe("over");
    expect(varianceState(3 * H, 6 * H)).toBe("under");
  });
  it("treats actuals against zero plan as 'over', and zero/zero as 'none'", () => {
    expect(varianceState(4 * H, 0)).toBe("over");
    expect(varianceState(0, 0)).toBe("none");
  });
});

describe("actualsForCell", () => {
  const rows: WorkloadActualRow[] = [
    { userId: "u1", boardId: "b1", day: "2026-06-01", secs: 2 * H }, // Mon, week of Jun 1
    { userId: "u1", boardId: "b2", day: "2026-06-01", secs: 1 * H }, // same day, other board
    { userId: "u1", boardId: "b1", day: "2026-06-05", secs: 3 * H }, // Fri, same week
    { userId: "u1", boardId: "b1", day: "2026-06-08", secs: 9 * H }, // next Mon, different week
    { userId: "u2", boardId: "b1", day: "2026-06-01", secs: 5 * H }, // different user
  ];
  it("returns only the target user's in-week days, aggregated across boards, sorted", () => {
    const out = actualsForCell(rows, "u1", "2026-06-01", 1, null);
    expect(out).toEqual([
      { day: "2026-06-01", secs: 3 * H },
      { day: "2026-06-05", secs: 3 * H },
    ]);
  });
  it("respects the active board filter", () => {
    const out = actualsForCell(rows, "u1", "2026-06-01", 1, new Set(["b1"]));
    expect(out).toEqual([
      { day: "2026-06-01", secs: 2 * H },
      { day: "2026-06-05", secs: 3 * H },
    ]);
  });
  it("is empty when the user has no actuals in that week", () => {
    expect(actualsForCell(rows, "u1", "2026-06-15", 1, null)).toEqual([]);
  });
});
