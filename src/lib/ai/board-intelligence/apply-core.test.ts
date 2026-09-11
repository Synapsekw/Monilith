import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import {
  applyCellWrites,
  applyNudge,
  isActionApplicable,
  planCellWrites,
} from "./apply-core";
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
  signals: [],
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
  // Overdue is decided by `(end ?? date) < today` (src/lib/boards/overdue.ts),
  // so keeping the old `end` left the row exactly as overdue as before — the
  // suggestion looked applied and changed nothing.
  it("set_due moves the end of a ranged item and never inverts it", () => {
    expect(
      planCellWrites(
        {
          type: "set_due",
          itemId: "i1",
          columnId: "c-date",
          date: "2026-09-10",
          label: "x",
        },
        ctx,
        cells,
      ),
    ).toEqual({
      ok: true,
      writes: [
        {
          item_id: "i1",
          column_id: "c-date",
          value: { date: "2026-09-01", end: "2026-09-10" },
        },
      ],
    });

    // Pulling the deadline EARLIER than the existing start would invert the
    // range, so the start comes with it.
    expect(
      planCellWrites(
        {
          type: "set_due",
          itemId: "i1",
          columnId: "c-date",
          date: "2026-09-05",
          label: "x",
        },
        ctx,
        [
          {
            item_id: "i1",
            column_id: "c-date",
            value: { date: "2026-09-08", end: "2026-09-09" },
          },
        ],
      ),
    ).toEqual({
      ok: true,
      writes: [
        {
          item_id: "i1",
          column_id: "c-date",
          value: { date: "2026-09-05", end: "2026-09-05" },
        },
      ],
    });
  });

  it("set_due on a single-date item writes just the date", () => {
    expect(
      planCellWrites(
        {
          type: "set_due",
          itemId: "i2",
          columnId: "c-date",
          date: "2026-09-10",
          label: "x",
        },
        ctx,
        cells,
      ),
    ).toEqual({
      ok: true,
      writes: [
        { item_id: "i2", column_id: "c-date", value: { date: "2026-09-10" } },
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

const ITEM_A = "i1";
const COL_A = "c1";
const COL_B = "c2";

/** A minimal fake `SupabaseClient` for `applyCellWrites`/`applyNudge`:
 *  `.rpc()` for the RPC call, `.from(table).insert(...)` chains for the
 *  nudge's `item_updates`/`notifications` writes. */
function makeRpcClient(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as never, rpc };
}

function makeNudgeClient(opts: {
  insertError?: { message: string } | null;
  notifyError?: { message: string } | null;
}) {
  const insertUpdate = vi.fn(() => ({
    select: () => ({
      single: async () =>
        opts.insertError
          ? { data: null, error: opts.insertError }
          : { data: { id: "u1" }, error: null },
    }),
  }));
  const insertNotification = vi
    .fn()
    .mockResolvedValue({ error: opts.notifyError ?? null });
  const client = {
    from: (table: string) => {
      if (table === "item_updates") return { insert: insertUpdate };
      if (table === "notifications") return { insert: insertNotification };
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { client: client as never, insertUpdate, insertNotification };
}

beforeEach(() => vi.restoreAllMocks());

describe("applyCellWrites", () => {
  it("maps before-values (null preserved) and splits cells into item_fields_set + cells_cleared", async () => {
    const { client, rpc } = makeRpcClient({
      data: {
        before: [
          { item_id: ITEM_A, column_id: COL_A, value: null },
          { item_id: ITEM_A, column_id: COL_B, value: { text: "old" } },
        ],
        cells: [
          {
            item_id: ITEM_A,
            column_id: COL_B,
            value: { text: "new" },
            org_id: "o",
            board_id: "b",
            updated_at: "2026-09-11T00:00:00.000Z",
          },
          { item_id: ITEM_A, column_id: COL_A, cleared: true },
        ],
      },
      error: null,
    });

    const res = await applyCellWrites(client, "b", [
      { item_id: ITEM_A, column_id: COL_B, value: { text: "new" } },
    ]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(res.before).toEqual([
      { itemId: ITEM_A, columnId: COL_A, value: null },
      { itemId: ITEM_A, columnId: COL_B, value: { text: "old" } },
    ]);
    expect(res.effects).toEqual([
      {
        kind: "item_fields_set",
        boardId: "b",
        cells: [
          {
            item_id: ITEM_A,
            column_id: COL_B,
            value: { text: "new" },
            org_id: "o",
            board_id: "b",
            updated_at: "2026-09-11T00:00:00.000Z",
          },
        ],
      },
      {
        kind: "cells_cleared",
        boardId: "b",
        cells: [{ itemId: ITEM_A, columnId: COL_A }],
      },
    ]);
  });

  it("throws the RPC's error message", async () => {
    const { client } = makeRpcClient({
      data: null,
      error: { message: "no edit access to this board" },
    });
    await expect(
      applyCellWrites(client, "b", [
        { item_id: ITEM_A, column_id: COL_A, value: null },
      ]),
    ).rejects.toThrow("no edit access to this board");
  });

  it("throws when the result fails the Zod shape gate (a malformed row)", async () => {
    const { client } = makeRpcClient({
      data: {
        before: [],
        cells: [{ column_id: COL_A, cleared: true }], // missing item_id
      },
      error: null,
    });
    await expect(
      applyCellWrites(client, "b", [
        { item_id: ITEM_A, column_id: COL_A, value: null },
      ]),
    ).rejects.toThrow();
  });
});

describe("applyNudge", () => {
  it("inserts the update as the actor, with a mention notification when the target differs", async () => {
    const { client, insertUpdate, insertNotification } = makeNudgeClient({});
    const res = await applyNudge(client, {
      orgId: "o",
      boardId: "b",
      itemId: ITEM_A,
      actorId: "actor",
      userId: "zed",
      message: "please look",
    });

    expect(res).toEqual({ updateId: "u1" });
    expect(insertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        author_id: "actor",
        body: { text: "please look" },
        body_text: "please look",
      }),
    );
    expect(insertNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_id: "zed",
        actor_id: "actor",
        kind: "mention",
        update_id: "u1",
      }),
    );
  });

  it("skips the notification when the target is the actor", async () => {
    const { client, insertNotification } = makeNudgeClient({});
    await applyNudge(client, {
      orgId: "o",
      boardId: "b",
      itemId: ITEM_A,
      actorId: "actor",
      userId: "actor",
      message: "note to self",
    });
    expect(insertNotification).not.toHaveBeenCalled();
  });

  it("logs but does not throw when the notification insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeNudgeClient({
      notifyError: { message: "insert denied" },
    });
    await expect(
      applyNudge(client, {
        orgId: "o",
        boardId: "b",
        itemId: ITEM_A,
        actorId: "actor",
        userId: "zed",
        message: "please look",
      }),
    ).resolves.toEqual({ updateId: "u1" });
    expect(spy).toHaveBeenCalledWith(
      "[intelligence] nudge notification failed",
      expect.objectContaining({ itemId: ITEM_A, error: "insert denied" }),
    );
  });

  it("throws when the update insert fails", async () => {
    const { client } = makeNudgeClient({
      insertError: { message: "insert denied" },
    });
    await expect(
      applyNudge(client, {
        orgId: "o",
        boardId: "b",
        itemId: ITEM_A,
        actorId: "actor",
        userId: "zed",
        message: "please look",
      }),
    ).rejects.toThrow("insert denied");
  });
});
