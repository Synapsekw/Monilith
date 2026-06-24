import { describe, expect, it } from "vitest";

import { weekDays, assembleTimeCard, mondayOf } from "./card";
import type { TimeAllocationRow } from "./types";

const USER = "00000000-0000-0000-0000-000000000000";
const ITEM = "11111111-1111-1111-1111-111111111111";
const BOARD = "22222222-2222-2222-2222-222222222222";

function alloc(part: Partial<TimeAllocationRow>): TimeAllocationRow {
  return {
    id: "x",
    org_id: "o",
    user_id: USER,
    work_date: "2026-06-22",
    item_id: null,
    board_id: null,
    category: null,
    duration_secs: 3600,
    note: null,
    created_at: "",
    updated_at: "",
    ...part,
  };
}

describe("weekDays", () => {
  it("returns 7 ISO dates Mon..Sun from a Monday start", () => {
    const days = weekDays("2026-06-22"); // a Monday
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-06-22");
    expect(days[6]).toBe("2026-06-28");
  });
});

describe("assembleTimeCard", () => {
  it("places a manual item allocation in the correct day cell", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [
        alloc({
          item_id: ITEM,
          board_id: BOARD,
          duration_secs: 9000,
          work_date: "2026-06-23",
        }),
      ],
      timer: [],
      itemMeta: new Map([[ITEM, { name: "Build API", boardName: "Eng" }]]),
    });
    const row = data.rows.find((r) => r.itemId === ITEM);
    expect(row).toBeDefined();
    expect(row!.label).toBe("Build API");
    const tue = row!.cells.find((c) => c.day === "2026-06-23")!;
    expect(tue.manualSecs).toBe(9000);
    expect(tue.timerSecs).toBe(0);
    expect(row!.totalSecs).toBe(9000);
  });

  it("merges timer secs into the same item row as a read-only sub-value (no double count)", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [
        alloc({
          item_id: ITEM,
          board_id: BOARD,
          duration_secs: 3600,
          work_date: "2026-06-22",
        }),
      ],
      timer: [{ itemId: ITEM, day: "2026-06-22", secs: 5400 }],
      itemMeta: new Map([[ITEM, { name: "Build API", boardName: "Eng" }]]),
    });
    const row = data.rows.find((r) => r.itemId === ITEM)!;
    const mon = row.cells.find((c) => c.day === "2026-06-22")!;
    expect(mon.manualSecs).toBe(3600); // editable portion only
    expect(mon.timerSecs).toBe(5400); // read-only
    // total reflects manual + timer, summed once
    expect(row.totalSecs).toBe(3600 + 5400);
  });

  it("creates a timer-only row for an item with no manual entry", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [],
      timer: [{ itemId: ITEM, day: "2026-06-22", secs: 7200 }],
      itemMeta: new Map([[ITEM, { name: "Build API", boardName: "Eng" }]]),
    });
    const row = data.rows.find((r) => r.itemId === ITEM)!;
    expect(row.cells.find((c) => c.day === "2026-06-22")!.timerSecs).toBe(7200);
    expect(row.totalSecs).toBe(7200);
  });

  it("creates a category row with board null and ignores timer for it", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [
        alloc({
          category: "Meetings",
          duration_secs: 3600,
          work_date: "2026-06-24",
        }),
      ],
      timer: [],
      itemMeta: new Map(),
    });
    const row = data.rows.find((r) => r.category === "Meetings")!;
    expect(row.kind).toBe("category");
    expect(row.boardId).toBeNull();
    expect(row.cells.find((c) => c.day === "2026-06-24")!.manualSecs).toBe(
      3600,
    );
  });

  it("ignores allocations outside the week window", () => {
    const data = assembleTimeCard({
      weekStart: "2026-06-22",
      userId: USER,
      allocations: [alloc({ category: "Admin", work_date: "2026-07-01" })],
      timer: [],
      itemMeta: new Map(),
    });
    expect(data.rows).toHaveLength(0);
  });
});

describe("mondayOf", () => {
  it("returns the Monday of the week for any day", () => {
    expect(mondayOf("2026-06-24")).toBe("2026-06-22"); // Wed -> Mon
    expect(mondayOf("2026-06-22")).toBe("2026-06-22"); // Mon -> Mon
    expect(mondayOf("2026-06-28")).toBe("2026-06-22"); // Sun -> Mon
  });
});
