import { describe, expect, it } from "vitest";
import {
  spreadItemEffort,
  bucketByWeek,
  buildWindow,
  capacityState,
  buildWorkloadGrid,
} from "@/lib/workload/rollup";
import type {
  MemberCapacity,
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
});
