import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isActionApplicable, planCellWrites } from "./apply-core";
import type { BoardContext } from "./board-context";

const ctx: BoardContext = {
  boardId: "b",
  orgId: "o",
  items: new Map([
    ["i1", { id: "i1", name: "Ship", groupId: "g", parentId: null }],
    ["i2", { id: "i2", name: "Test", groupId: "g", parentId: null }],
  ]),
  columns: new Map([
    [
      "c-people",
      { id: "c-people", name: "Owner", kind: "people", options: new Map() },
    ],
    ["c-date", { id: "c-date", name: "Due", kind: "date", options: new Map() }],
    [
      "c-status",
      {
        id: "c-status",
        name: "Status",
        kind: "status",
        options: new Map([["o-done", "Done"]]),
      },
    ],
  ]),
  members: new Map([["u-ana", "Ana"]]),
};
const cells = [
  {
    item_id: "i1",
    column_id: "c-date",
    value: { date: "2026-09-01", end: "2026-09-03" },
  },
];

describe("planCellWrites", () => {
  it("reassign replaces the owners of every item with the target", () => {
    const r = planCellWrites(
      {
        type: "reassign",
        itemIds: ["i1", "i2"],
        columnId: "c-people",
        toUserId: "u-ana",
        label: "x",
      },
      ctx,
      cells,
    );
    expect(r).toEqual({
      ok: true,
      writes: [
        { item_id: "i1", column_id: "c-people", value: { userIds: ["u-ana"] } },
        { item_id: "i2", column_id: "c-people", value: { userIds: ["u-ana"] } },
      ],
    });
  });
  it("set_due keeps an existing end date", () => {
    const r = planCellWrites(
      {
        type: "set_due",
        itemId: "i1",
        columnId: "c-date",
        date: "2026-09-10",
        label: "x",
      },
      ctx,
      cells,
    );
    expect(r).toEqual({
      ok: true,
      writes: [
        {
          item_id: "i1",
          column_id: "c-date",
          value: { date: "2026-09-10", end: "2026-09-03" },
        },
      ],
    });
  });
  it("set_status writes the option id", () => {
    const r = planCellWrites(
      {
        type: "set_status",
        itemId: "i2",
        columnId: "c-status",
        optionId: "o-done",
        label: "x",
      },
      ctx,
      cells,
    );
    expect(r).toEqual({
      ok: true,
      writes: [
        { item_id: "i2", column_id: "c-status", value: { optionId: "o-done" } },
      ],
    });
  });
  it("refuses a value the column's schema rejects", () => {
    const r = planCellWrites(
      {
        type: "set_due",
        itemId: "i1",
        columnId: "c-date",
        date: "not-a-date",
        label: "x",
      },
      ctx,
      cells,
    );
    expect(r.ok).toBe(false);
  });
});

describe("isActionApplicable", () => {
  it("re-checks ids against the current board", () => {
    expect(
      isActionApplicable(
        {
          type: "set_status",
          itemId: "i1",
          columnId: "c-status",
          optionId: "o-done",
          label: "x",
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      isActionApplicable(
        {
          type: "set_status",
          itemId: "i1",
          columnId: "c-status",
          optionId: "o-gone",
          label: "x",
        },
        ctx,
      ),
    ).toBe(false);
    expect(
      isActionApplicable(
        {
          type: "reassign",
          itemIds: ["i9"],
          columnId: "c-people",
          toUserId: "u-ana",
          label: "x",
        },
        ctx,
      ),
    ).toBe(false);
    expect(
      isActionApplicable(
        {
          type: "nudge",
          itemId: "i1",
          userId: "u-zed",
          message: "m",
          label: "x",
        },
        ctx,
      ),
    ).toBe(false);
    expect(
      isActionApplicable(
        { type: "filter", signalKind: "overdue", label: "x" },
        ctx,
      ),
    ).toBe(true);
  });
});
