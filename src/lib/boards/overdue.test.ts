import { describe, expect, it } from "vitest";
import { isItemComplete, isOverdue, localTodayISO } from "./overdue";

describe("isOverdue", () => {
  it("is true strictly before today, false today/after/missing", () => {
    expect(isOverdue({ date: "2026-07-02" }, "2026-07-03")).toBe(true);
    expect(isOverdue({ date: "2026-07-03" }, "2026-07-03")).toBe(false);
    expect(isOverdue({ date: "2026-07-04" }, "2026-07-03")).toBe(false);
    expect(isOverdue({}, "2026-07-03")).toBe(false);
    expect(isOverdue(null, "2026-07-03")).toBe(false);
    expect(isOverdue(undefined, "2026-07-03")).toBe(false);
    expect(isOverdue("2026-07-01", "2026-07-03")).toBe(false);
  });

  it("uses end when present (end ?? date)", () => {
    expect(
      isOverdue({ date: "2026-06-01", end: "2026-07-04" }, "2026-07-03"),
    ).toBe(false);
    expect(
      isOverdue({ date: "2026-07-04", end: "2026-07-01" }, "2026-07-03"),
    ).toBe(true);
  });

  it("ignores malformed date fields", () => {
    expect(isOverdue({ date: 42 }, "2026-07-03")).toBe(false);
    expect(isOverdue({ date: null, end: null }, "2026-07-03")).toBe(false);
  });
});

describe("isItemComplete", () => {
  const statusCol = {
    id: "c1",
    kind: "status",
    position: 0,
    settings: {
      options: [
        { id: "o1", label: "Working on it", color: "#fdab3d" },
        { id: "o2", label: "Done", color: "#00c875" },
        { id: "o3", label: "Completed", color: "#00c875" },
      ],
    },
  };
  const cell = (optionId: string | null) =>
    ({ item_id: "i1", column_id: "c1", value: { optionId } }) as never;

  it("done-labeled option => complete (case-insensitive, 'Completed' too)", () => {
    expect(isItemComplete("i1", [statusCol] as never, [cell("o2")])).toBe(true);
    expect(isItemComplete("i1", [statusCol] as never, [cell("o3")])).toBe(true);
  });

  it("non-done option, empty cell, or no status column => incomplete", () => {
    expect(isItemComplete("i1", [statusCol] as never, [cell("o1")])).toBe(
      false,
    );
    expect(isItemComplete("i1", [statusCol] as never, [cell(null)])).toBe(
      false,
    );
    expect(isItemComplete("i1", [statusCol] as never, [])).toBe(false);
    expect(isItemComplete("i1", [], [])).toBe(false);
  });

  it("uses the FIRST status column by position", () => {
    const secondStatus = {
      id: "c2",
      kind: "status",
      position: 5,
      settings: {
        options: [{ id: "d1", label: "Done", color: "#00c875" }],
      },
    };
    const doneOnSecondOnly = [
      { item_id: "i1", column_id: "c2", value: { optionId: "d1" } },
    ] as never[];
    // c1 (position 0) is the first status column; its cell is empty, so the
    // done value on c2 must not count.
    expect(
      isItemComplete(
        "i1",
        [secondStatus, statusCol] as never,
        doneOnSecondOnly,
      ),
    ).toBe(false);
  });

  it("only reads the given item's cells", () => {
    const otherItemsCell = [
      { item_id: "i2", column_id: "c1", value: { optionId: "o2" } },
    ] as never[];
    expect(isItemComplete("i1", [statusCol] as never, otherItemsCell)).toBe(
      false,
    );
  });
});

it("localTodayISO formats the local date", () => {
  expect(localTodayISO(new Date(2026, 6, 3, 23, 30))).toBe("2026-07-03");
  expect(localTodayISO(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
});
