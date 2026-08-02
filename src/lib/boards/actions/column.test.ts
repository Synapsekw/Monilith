import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));

import {
  createColumn,
  renameColumn,
  resizeColumn,
  reorderColumn,
  resizeNameColumn,
  updateColumnSettings,
  removeColumnOption,
  deleteColumn,
} from "./column";

const COLUMN_ID = "33333333-3333-4333-8333-333333333333";
const BOARD_ID = "44444444-4444-4444-8444-444444444444";
const ORG_ID = "55555555-5555-4555-8555-555555555555";

/**
 * Every column read in this module is the same builder chain:
 * `.from("columns").select(...).eq("id", …).maybeSingle()`. `columnBoardId`
 * selects `board_id`; `updateColumnSettings` selects `board_id, kind`.
 * `maybeSingle()` yields `{ data: null }` — not an error — for a column the
 * caller's org cannot see, which is exactly the fail-closed path under test.
 */
function columnRead(data: Record<string, unknown> | null) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  };
}

/** The `columnBoardId` lookup; `null` = the column does not resolve. */
function boardIdLookup(boardId: string | null) {
  return columnRead(boardId ? { board_id: boardId } : null);
}

function updateTable(
  opts: { onUpdate?: (patch: unknown) => void; error?: unknown } = {},
) {
  return {
    update: (patch: unknown) => ({
      eq: vi.fn().mockImplementation(async () => {
        opts.onUpdate?.(patch);
        return { error: opts.error ?? null };
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReset();
  from.mockReset();
});

describe("createColumn", () => {
  it("rejects an invalid board id before touching the database", async () => {
    const res = await createColumn({ boardId: "nope", kind: "text" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects initial settings that do not match the kind, before any query", async () => {
    // A relation column must carry a target_board_id.
    const res = await createColumn({
      boardId: BOARD_ID,
      kind: "relation",
      settings: { allow_multiple: true },
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the board is not visible to the caller", async () => {
    from.mockImplementation((table: string) => {
      if (table === "boards") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected read of ${table}`);
    });
    const res = await createColumn({ boardId: BOARD_ID, kind: "text" });
    expect(res).toEqual({ ok: false, error: "Board not found." });
  });

  /** boards read → columns "last position" read → columns insert. */
  function createClientMock(opts: {
    onInsert?: (row: Record<string, unknown>) => void;
    insert?: { data: unknown; error: unknown };
    lastPosition?: number | null;
  }) {
    return (table: string) => {
      if (table === "boards") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { org_id: ORG_ID }, error: null }),
            }),
          }),
        } as never;
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data:
                    opts.lastPosition == null
                      ? null
                      : { position: opts.lastPosition },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          opts.onInsert?.(row);
          return {
            select: () => ({
              single: vi.fn().mockResolvedValue(
                opts.insert ?? {
                  data: { id: COLUMN_ID, ...row },
                  error: null,
                },
              ),
            }),
          };
        },
      } as never;
    };
  }

  it("inserts with the board's org_id and the kind's default name/settings", async () => {
    const onInsert = vi.fn();
    from.mockImplementation(createClientMock({ onInsert, lastPosition: 1000 }));
    const res = await createColumn({ boardId: BOARD_ID, kind: "status" });
    expect(res.ok).toBe(true);
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        board_id: BOARD_ID,
        kind: "status",
        name: "Status",
      }),
    );
    const row = onInsert.mock.calls[0]![0] as {
      settings: { options: unknown[] };
      position: number;
    };
    expect(row.settings.options).toHaveLength(3);
    expect(row.position).toBeGreaterThan(1000);
  });

  it("prefers explicitly supplied settings over the kind default", async () => {
    const onInsert = vi.fn();
    from.mockImplementation(createClientMock({ onInsert }));
    const res = await createColumn({
      boardId: BOARD_ID,
      kind: "numbers",
      name: "  Budget  ",
      settings: { unit: "kg", precision: 2 },
    });
    expect(res.ok).toBe(true);
    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Budget",
        settings: { unit: "kg", precision: 2 },
      }),
    );
  });

  it("surfaces an insert error", async () => {
    from.mockImplementation(
      createClientMock({ insert: { data: null, error: { message: "rls" } } }),
    );
    const res = await createColumn({ boardId: BOARD_ID, kind: "text" });
    expect(res).toEqual({ ok: false, error: "rls" });
  });
});

describe("renameColumn", () => {
  it("rejects an invalid column id before touching the database", async () => {
    const res = await renameColumn({ columnId: "nope", name: "Status" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the column is not visible to the caller", async () => {
    const onUpdate = vi.fn();
    from.mockReturnValue({
      ...boardIdLookup(null),
      ...updateTable({ onUpdate }),
    });
    const res = await renameColumn({ columnId: COLUMN_ID, name: "Status" });
    expect(res).toEqual({ ok: false, error: "Column not found." });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("updates the name once the column resolves", async () => {
    const onUpdate = vi.fn();
    let call = 0;
    from.mockImplementation(() =>
      ++call === 1 ? boardIdLookup(BOARD_ID) : updateTable({ onUpdate }),
    );
    const res = await renameColumn({ columnId: COLUMN_ID, name: "Status" });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onUpdate).toHaveBeenCalledWith({ name: "Status" });
  });
});

describe("resizeColumn", () => {
  it("rejects a width outside the allowed range before touching the database", async () => {
    const res = await resizeColumn({ columnId: COLUMN_ID, width: 10 });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the column is not visible to the caller", async () => {
    const onUpdate = vi.fn();
    from.mockReturnValue({
      ...boardIdLookup(null),
      ...updateTable({ onUpdate }),
    });
    const res = await resizeColumn({ columnId: COLUMN_ID, width: 200 });
    expect(res).toEqual({ ok: false, error: "Column not found." });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("writes the width once the column resolves", async () => {
    const onUpdate = vi.fn();
    let call = 0;
    from.mockImplementation(() =>
      ++call === 1 ? boardIdLookup(BOARD_ID) : updateTable({ onUpdate }),
    );
    const res = await resizeColumn({ columnId: COLUMN_ID, width: 200 });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onUpdate).toHaveBeenCalledWith({ width: 200 });
  });

  it("propagates an update error", async () => {
    let call = 0;
    from.mockImplementation(() =>
      ++call === 1
        ? boardIdLookup(BOARD_ID)
        : updateTable({ error: { message: "rls" } }),
    );
    const res = await resizeColumn({ columnId: COLUMN_ID, width: 200 });
    expect(res).toEqual({ ok: false, error: "rls" });
  });
});

describe("reorderColumn", () => {
  /**
   * reorderColumn does the scoping differently: it writes first and reads the
   * affected row back (`.update(...).eq(...).select("board_id").maybeSingle()`).
   * RLS makes the write a no-op for an invisible column, so `data === null` is
   * the fail-closed signal.
   */
  function reorderTable(
    result: { data: unknown; error: unknown },
    onUpdate?: (p: unknown) => void,
  ) {
    return {
      update: (patch: unknown) => {
        onUpdate?.(patch);
        return {
          eq: () => ({
            select: () => ({ maybeSingle: vi.fn().mockResolvedValue(result) }),
          }),
        };
      },
    };
  }

  it("rejects an invalid column id before touching the database", async () => {
    const res = await reorderColumn({ columnId: "nope", position: 1 });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the write matched no visible row", async () => {
    from.mockReturnValue(reorderTable({ data: null, error: null }));
    const res = await reorderColumn({ columnId: COLUMN_ID, position: 1500 });
    expect(res).toEqual({ ok: false, error: "Column not found." });
  });

  it("writes the position and returns ok", async () => {
    const onUpdate = vi.fn();
    from.mockReturnValue(
      reorderTable({ data: { board_id: BOARD_ID }, error: null }, onUpdate),
    );
    const res = await reorderColumn({ columnId: COLUMN_ID, position: 1500 });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onUpdate).toHaveBeenCalledWith({ position: 1500 });
  });

  it("propagates an update error", async () => {
    from.mockReturnValue(
      reorderTable({ data: null, error: { message: "boom" } }),
    );
    const res = await reorderColumn({ columnId: COLUMN_ID, position: 1 });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});

describe("resizeNameColumn", () => {
  it("rejects an invalid board id before touching the database", async () => {
    const res = await resizeNameColumn({ boardId: "nope", width: 200 });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("clears the manual width with null (auto-fit)", async () => {
    const onUpdate = vi.fn();
    from.mockReturnValue(updateTable({ onUpdate }));
    const res = await resizeNameColumn({ boardId: BOARD_ID, width: null });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(from).toHaveBeenCalledWith("boards");
    expect(onUpdate).toHaveBeenCalledWith({ name_column_width: null });
  });

  it("propagates an update error", async () => {
    from.mockReturnValue(updateTable({ error: { message: "rls" } }));
    const res = await resizeNameColumn({ boardId: BOARD_ID, width: 300 });
    expect(res).toEqual({ ok: false, error: "rls" });
  });
});

describe("updateColumnSettings", () => {
  it("rejects an invalid column id before touching the database", async () => {
    const res = await updateColumnSettings({ columnId: "nope", settings: {} });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the column is not visible to the caller", async () => {
    const onUpdate = vi.fn();
    from.mockReturnValue({ ...columnRead(null), ...updateTable({ onUpdate }) });
    const res = await updateColumnSettings({
      columnId: COLUMN_ID,
      settings: { unit: "kg" },
    });
    expect(res).toEqual({ ok: false, error: "Column not found." });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("rejects settings that do not match the stored kind, without writing", async () => {
    const onUpdate = vi.fn();
    let call = 0;
    from.mockImplementation(() =>
      ++call === 1
        ? columnRead({ board_id: BOARD_ID, kind: "numbers" })
        : updateTable({ onUpdate }),
    );
    const res = await updateColumnSettings({
      columnId: COLUMN_ID,
      settings: { precision: 99 },
    });
    expect(res.ok).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("writes the parsed settings for the stored kind", async () => {
    const onUpdate = vi.fn();
    let call = 0;
    from.mockImplementation(() =>
      ++call === 1
        ? columnRead({ board_id: BOARD_ID, kind: "numbers" })
        : updateTable({ onUpdate }),
    );
    const res = await updateColumnSettings({
      columnId: COLUMN_ID,
      settings: { unit: "kg", precision: 2 },
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onUpdate).toHaveBeenCalledWith({
      settings: { unit: "kg", precision: 2 },
    });
  });
});

describe("removeColumnOption", () => {
  it("rejects an empty option id before touching the database", async () => {
    const res = await removeColumnOption({ columnId: COLUMN_ID, optionId: "" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed without calling the RPC when the column does not resolve", async () => {
    from.mockReturnValue(boardIdLookup(null));
    const res = await removeColumnOption({
      columnId: COLUMN_ID,
      optionId: "o1",
    });
    expect(res).toEqual({ ok: false, error: "Column not found." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls delete_column_option and returns the cleared cell count", async () => {
    from.mockReturnValue(boardIdLookup(BOARD_ID));
    rpc.mockResolvedValue({ data: 7, error: null });
    const res = await removeColumnOption({
      columnId: COLUMN_ID,
      optionId: "o1",
    });
    expect(rpc).toHaveBeenCalledWith("delete_column_option", {
      p_column_id: COLUMN_ID,
      p_option_id: "o1",
    });
    expect(res).toEqual({ ok: true, data: { clearedCells: 7 } });
  });

  it("surfaces an RPC error", async () => {
    from.mockReturnValue(boardIdLookup(BOARD_ID));
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await removeColumnOption({
      columnId: COLUMN_ID,
      optionId: "o1",
    });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});

describe("deleteColumn", () => {
  function deletableColumn(
    boardId: string | null,
    onDelete: () => void,
    error: unknown = null,
  ) {
    return {
      ...boardIdLookup(boardId),
      delete: () => {
        onDelete();
        return { eq: vi.fn().mockResolvedValue({ error }) };
      },
    };
  }

  it("rejects an invalid column id before touching the database", async () => {
    const res = await deleteColumn({ columnId: "nope" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("issues no delete when the column does not resolve", async () => {
    const onDelete = vi.fn();
    from.mockReturnValue(deletableColumn(null, onDelete));
    const res = await deleteColumn({ columnId: COLUMN_ID });
    expect(res).toEqual({ ok: false, error: "Column not found." });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("deletes the column once it resolves", async () => {
    const onDelete = vi.fn();
    from.mockReturnValue(deletableColumn(BOARD_ID, onDelete));
    const res = await deleteColumn({ columnId: COLUMN_ID });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("propagates a delete error", async () => {
    const onDelete = vi.fn();
    from.mockReturnValue(
      deletableColumn(BOARD_ID, onDelete, { message: "rls" }),
    );
    const res = await deleteColumn({ columnId: COLUMN_ID });
    expect(res).toEqual({ ok: false, error: "rls" });
  });
});
