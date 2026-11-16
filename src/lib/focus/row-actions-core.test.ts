import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const upsertCellCore = vi.fn();
vi.mock("@/lib/boards/actions/cell-core", () => ({
  upsertCellCore: (...a: unknown[]) => upsertCellCore(...a),
}));

import { markItemDoneCore, setItemDueDateCore } from "./row-actions-core";

type Row = Record<string, unknown>;

const BOARD = "b1";
const ITEM = "i1";
const ACTOR = "u1";

const STATUS = {
  id: "s1",
  board_id: BOARD,
  name: "Status",
  kind: "status",
  position: 1,
  settings: {
    options: [
      { id: "o1", label: "Working on it", color: "#888888" },
      { id: "o2", label: "Done", color: "#00aa00" },
      { id: "o3", label: "Shipped", color: "#0000aa" },
    ],
  },
};
const STATUS_2 = { ...STATUS, id: "s2", name: "Review", position: 5 };
const START = {
  id: "d0",
  board_id: BOARD,
  name: "Start",
  kind: "date",
  position: 2,
  settings: {},
};
const DUE = { ...START, id: "d1", name: "Due date", position: 3 };
const OTHER_BOARD_STATUS = { ...STATUS, id: "sx", board_id: "b2" };

/**
 * PostgREST double that applies `.eq` and `.in`, so reading the wrong board's
 * columns or the wrong cell returns nothing. Records every table read.
 */
function client(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () =>
      (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return q;
      },
      in: (k: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[k]));
        return q;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: rows(), error: null }),
    };
    return q;
  };
  return { supabase: { from } as never, reads };
}

function tables(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    items: [{ id: ITEM, board_id: BOARD }],
    boards: [
      {
        id: BOARD,
        work_status_column_id: null,
        work_done_option_ids: null,
        work_due_column_id: null,
      },
    ],
    columns: [STATUS_2, STATUS, START, DUE, OTHER_BOARD_STATUS],
    cell_values: [],
    ...over,
  };
}

beforeEach(() => {
  upsertCellCore.mockReset();
  upsertCellCore.mockResolvedValue({ ok: true, data: { cell: {} } });
});

describe("markItemDoneCore", () => {
  it("writes the guessed done option to the guessed status column, through the one cell-write path", async () => {
    const { supabase } = client(tables());
    const res = await markItemDoneCore(supabase, { itemId: ITEM }, ACTOR);
    expect(res).toEqual({ ok: true, data: { optionLabel: "Done" } });
    expect(upsertCellCore).toHaveBeenCalledTimes(1);
    expect(upsertCellCore).toHaveBeenCalledWith(
      supabase,
      // s1, not s2: the lowest-position status column, as item_facts picks.
      { itemId: ITEM, columnId: "s1", value: { optionId: "o2" } },
      ACTOR,
    );
  });

  it("follows the board's Work tracking settings over the guess", async () => {
    const { supabase } = client(
      tables({
        boards: [
          {
            id: BOARD,
            work_status_column_id: "s2",
            work_done_option_ids: ["o3"],
            work_due_column_id: null,
          },
        ],
      }),
    );
    const res = await markItemDoneCore(supabase, { itemId: ITEM }, ACTOR);
    expect(res).toEqual({ ok: true, data: { optionLabel: "Shipped" } });
    expect(upsertCellCore.mock.calls[0][1]).toEqual({
      itemId: ITEM,
      columnId: "s2",
      value: { optionId: "o3" },
    });
  });

  it("returns the cell-write refusal (a view-only member) and writes nothing else", async () => {
    upsertCellCore.mockResolvedValue({
      ok: false,
      error: "new row violates row-level security policy",
    });
    const { supabase } = client(tables());
    expect(await markItemDoneCore(supabase, { itemId: ITEM }, ACTOR)).toEqual({
      ok: false,
      error: "new row violates row-level security policy",
    });
  });

  it("says so when the board has no status column", async () => {
    const { supabase } = client(tables({ columns: [START, DUE] }));
    const res = await markItemDoneCore(supabase, { itemId: ITEM }, ACTOR);
    expect(res).toMatchObject({ ok: false });
    expect(!res.ok && res.error).toMatch(/no status column/);
    expect(upsertCellCore).not.toHaveBeenCalled();
  });

  it("says so when no option means done, and points at Work tracking", async () => {
    const open = {
      ...STATUS,
      settings: {
        options: [{ id: "o1", label: "Working on it", color: "#888888" }],
      },
    };
    const { supabase } = client(tables({ columns: [open] }));
    const res = await markItemDoneCore(supabase, { itemId: ITEM }, ACTOR);
    expect(!res.ok && res.error).toMatch(/Work tracking/);
    expect(upsertCellCore).not.toHaveBeenCalled();
  });

  it("a stale configured status column gives no column, never a silent fallback", async () => {
    const { supabase } = client(
      tables({
        boards: [
          {
            id: BOARD,
            work_status_column_id: "deleted",
            work_done_option_ids: ["o2"],
            work_due_column_id: null,
          },
        ],
      }),
    );
    const res = await markItemDoneCore(supabase, { itemId: ITEM }, ACTOR);
    expect(res.ok).toBe(false);
    expect(upsertCellCore).not.toHaveBeenCalled();
  });

  it("fails for an item the caller cannot read, before any write", async () => {
    const { supabase } = client(tables({ items: [] }));
    expect(await markItemDoneCore(supabase, { itemId: ITEM }, ACTOR)).toEqual({
      ok: false,
      error: "Item not found.",
    });
    expect(upsertCellCore).not.toHaveBeenCalled();
  });

  it("costs a fixed number of reads, whatever the board holds", async () => {
    const { supabase, reads } = client(tables());
    await markItemDoneCore(supabase, { itemId: ITEM }, ACTOR);
    expect(reads.sort()).toEqual(["boards", "columns", "items"]);
  });
});

describe("setItemDueDateCore", () => {
  it("writes the new day to the guessed due column ('Due date', not 'Start')", async () => {
    const { supabase } = client(tables());
    const res = await setItemDueDateCore(
      supabase,
      { itemId: ITEM, dueDate: "2026-11-20" },
      ACTOR,
    );
    expect(res).toEqual({ ok: true, data: { dueDate: "2026-11-20" } });
    expect(upsertCellCore).toHaveBeenCalledWith(
      supabase,
      { itemId: ITEM, columnId: "d1", value: { date: "2026-11-20" } },
      ACTOR,
    );
  });

  it("keeps the start of an existing range and moves its end", async () => {
    const { supabase } = client(
      tables({
        cell_values: [
          // Another item's cell in the same column must not be read.
          {
            item_id: "other",
            column_id: "d1",
            value: { date: "2026-01-01", end: "2026-01-05" },
          },
          {
            item_id: ITEM,
            column_id: "d1",
            value: { date: "2026-11-10", end: "2026-11-14" },
          },
        ],
      }),
    );
    await setItemDueDateCore(
      supabase,
      { itemId: ITEM, dueDate: "2026-11-20" },
      ACTOR,
    );
    expect(upsertCellCore.mock.calls[0][1]).toEqual({
      itemId: ITEM,
      columnId: "d1",
      value: { date: "2026-11-10", end: "2026-11-20" },
    });
  });

  it("follows the configured due column", async () => {
    const { supabase } = client(
      tables({
        boards: [
          {
            id: BOARD,
            work_status_column_id: null,
            work_done_option_ids: null,
            work_due_column_id: "d0",
          },
        ],
      }),
    );
    await setItemDueDateCore(
      supabase,
      { itemId: ITEM, dueDate: "2026-11-20" },
      ACTOR,
    );
    expect(upsertCellCore.mock.calls[0][1]).toMatchObject({ columnId: "d0" });
  });

  it("says so when the board has no date column", async () => {
    const { supabase } = client(tables({ columns: [STATUS] }));
    const res = await setItemDueDateCore(
      supabase,
      { itemId: ITEM, dueDate: "2026-11-20" },
      ACTOR,
    );
    expect(!res.ok && res.error).toMatch(/no due date column/);
    expect(upsertCellCore).not.toHaveBeenCalled();
  });

  it("returns the cell-write refusal unchanged", async () => {
    upsertCellCore.mockResolvedValue({ ok: false, error: "denied" });
    const { supabase } = client(tables());
    expect(
      await setItemDueDateCore(
        supabase,
        { itemId: ITEM, dueDate: "2026-11-20" },
        ACTOR,
      ),
    ).toEqual({ ok: false, error: "denied" });
  });
});
