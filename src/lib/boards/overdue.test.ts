import { describe, expect, it } from "vitest";
import {
  boardWorkRule,
  dueISO,
  isDueColumn,
  isItemComplete,
  isOverdue,
  isStatusValueComplete,
  localTodayISO,
} from "./overdue";

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

  it("uses end when present (end, else date)", () => {
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
    // Not a calendar date: the view's due_date is null for these too.
    expect(isOverdue({ date: "0000" }, "2026-07-03")).toBe(false);
    expect(isOverdue({ date: "2026-02-31" }, "2026-07-03")).toBe(false);
  });
});

const statusCol = {
  id: "c1",
  name: "Status",
  kind: "status",
  position: 0,
  settings: {
    options: [
      { id: "o1", label: "Working on it", color: "#fdab3d" },
      { id: "o2", label: "Done", color: "#00c875" },
      { id: "o3", label: "Completed", color: "#00c875" },
      { id: "o4", label: "Cancelled", color: "#888" },
      { id: "o5", label: "Incomplete", color: "#888" },
    ],
  },
};
const secondStatus = {
  id: "c2",
  name: "Stage",
  kind: "status",
  position: 5,
  settings: { options: [{ id: "d1", label: "Done", color: "#00c875" }] },
};
const cell = (optionId: string | null, columnId = "c1") =>
  ({ item_id: "i1", column_id: columnId, value: { optionId } }) as never;

describe("isItemComplete (guess: no Work tracking settings)", () => {
  it("done-looking option => complete ('Completed' and 'Cancelled' too)", () => {
    expect(isItemComplete("i1", [statusCol] as never, [cell("o2")])).toBe(true);
    expect(isItemComplete("i1", [statusCol] as never, [cell("o3")])).toBe(true);
    expect(isItemComplete("i1", [statusCol] as never, [cell("o4")])).toBe(true);
  });

  it("'Incomplete' is open, though it contains 'complete'", () => {
    expect(isItemComplete("i1", [statusCol] as never, [cell("o5")])).toBe(
      false,
    );
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

  it("uses the lowest-position status column", () => {
    // c1 (position 0) is the status column; its cell is empty, so the done
    // value on c2 must not count.
    expect(
      isItemComplete("i1", [secondStatus, statusCol] as never, [
        cell("d1", "c2"),
      ]),
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

describe("isItemComplete (configured Work tracking)", () => {
  const columns = [secondStatus, statusCol] as never;

  it("reads the CONFIGURED status column, not the first one", () => {
    const board = {
      work_status_column_id: "c2",
      work_done_option_ids: null,
      work_due_column_id: null,
    };
    expect(isItemComplete("i1", columns, [cell("d1", "c2")], board)).toBe(true);
    // Done in the first column no longer counts.
    expect(isItemComplete("i1", columns, [cell("o2")], board)).toBe(false);
  });

  it("uses the configured done options instead of the labels", () => {
    const board = {
      work_status_column_id: "c1",
      work_done_option_ids: ["o1"],
      work_due_column_id: null,
    };
    // "Working on it" is configured as done; "Done" is not.
    expect(isItemComplete("i1", columns, [cell("o1")], board)).toBe(true);
    expect(isItemComplete("i1", columns, [cell("o2")], board)).toBe(false);
  });

  it("ignores done options when no status column is configured (the view does too)", () => {
    const board = {
      work_status_column_id: null,
      work_done_option_ids: ["o1"],
      work_due_column_id: null,
    };
    expect(isItemComplete("i1", columns, [cell("o1")], board)).toBe(false);
    expect(isItemComplete("i1", columns, [cell("o2")], board)).toBe(true);
  });

  it("a configured status column that no longer exists means nothing is done", () => {
    const board = {
      work_status_column_id: "gone",
      work_done_option_ids: null,
      work_due_column_id: null,
    };
    expect(isItemComplete("i1", columns, [cell("o2")], board)).toBe(false);
  });
});

it("localTodayISO formats the local date", () => {
  expect(localTodayISO(new Date(2026, 6, 3, 23, 30))).toBe("2026-07-03");
  expect(localTodayISO(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
});

describe("boardWorkRule", () => {
  const start = { id: "d1", name: "Start", kind: "date", position: 1 };
  const due = { id: "d2", name: "Due", kind: "date", position: 2 };
  const review = { id: "d3", name: "Review", kind: "date", position: 3 };
  const text = { id: "t1", name: "Notes", kind: "text", position: 0 };
  const columns = [text, start, due, review, statusCol, secondStatus] as never;

  it("guesses the status column and ONE due column", () => {
    const rule = boardWorkRule(columns);
    expect(rule.statusColumn?.id).toBe("c1");
    expect(rule.doneOptionIds).toBeNull();
    expect(rule.dueColumn?.id).toBe("d2");
  });

  it("only the due column may tint: Start and Review are not it", () => {
    const rule = boardWorkRule(columns);
    expect(isDueColumn(rule, "d2")).toBe(true);
    expect(isDueColumn(rule, "d1")).toBe(false);
    expect(isDueColumn(rule, "d3")).toBe(false);
    expect(isDueColumn(null, "d2")).toBe(false);
  });

  it("takes the configured due column over the guess", () => {
    const rule = boardWorkRule(columns, {
      work_status_column_id: null,
      work_done_option_ids: null,
      work_due_column_id: "d3",
    });
    expect(rule.dueColumn?.id).toBe("d3");
    expect(isDueColumn(rule, "d2")).toBe(false);
  });

  it("a configured due column that is gone or not a date gives no due column", () => {
    for (const id of ["gone", "t1"]) {
      const rule = boardWorkRule(columns, {
        work_status_column_id: null,
        work_done_option_ids: null,
        work_due_column_id: id,
      });
      expect(rule.dueColumn).toBeNull();
    }
  });

  it("has no columns to offer on a board without status or date columns", () => {
    const rule = boardWorkRule([text] as never);
    expect(rule.statusColumn).toBeNull();
    expect(rule.dueColumn).toBeNull();
  });
});

describe("isStatusValueComplete", () => {
  const rule = boardWorkRule([statusCol] as never);

  it("is true only for a done option of the rule's status column", () => {
    expect(isStatusValueComplete({ optionId: "o2" }, rule)).toBe(true);
    expect(isStatusValueComplete({ optionId: "o1" }, rule)).toBe(false);
    expect(isStatusValueComplete({ optionId: "nope" }, rule)).toBe(false);
  });

  it("is false for an empty value or a board with no status column", () => {
    expect(isStatusValueComplete(null, rule)).toBe(false);
    expect(isStatusValueComplete({ optionId: null }, rule)).toBe(false);
    expect(isStatusValueComplete({ optionId: "o2" }, null)).toBe(false);
    expect(
      isStatusValueComplete(
        { optionId: "o2" },
        { statusColumn: null, doneOptionIds: null },
      ),
    ).toBe(false);
  });

  it("a configured done option counts even when it was deleted from the column", () => {
    // The view compares ids only (`optionId = any(work_done_option_ids)`).
    expect(
      isStatusValueComplete(
        { optionId: "ghost" },
        { statusColumn: statusCol as never, doneOptionIds: ["ghost"] },
      ),
    ).toBe(true);
  });

  it("agrees with isItemComplete for the same board state", () => {
    const cells = [
      { item_id: "i1", column_id: "c1", value: { optionId: "o2" } },
    ] as never[];
    expect(isStatusValueComplete({ optionId: "o2" }, rule)).toBe(
      isItemComplete("i1", [statusCol] as never, cells),
    );
  });
});

describe("dueISO", () => {
  it("reads end, else date, and rejects anything else", () => {
    expect(dueISO({ date: "2026-07-02" })).toBe("2026-07-02");
    expect(dueISO({ date: "2026-06-01", end: "2026-07-04" })).toBe(
      "2026-07-04",
    );
    expect(dueISO({ date: 42 })).toBeNull();
    expect(dueISO(null)).toBeNull();
    expect(dueISO("2026-07-01")).toBeNull();
  });

  it("matches the view: empty end falls back to date, timestamps are cut to the day, junk is null", () => {
    expect(dueISO({ date: "2026-07-02", end: "" })).toBe("2026-07-02");
    expect(dueISO({ date: "2026-07-02T10:00:00Z" })).toBe("2026-07-02");
    expect(dueISO({ date: "TBD" })).toBeNull();
    expect(dueISO({ date: "2026-02-31" })).toBeNull();
    expect(dueISO({ date: "2026-13-01" })).toBeNull();
  });
});
