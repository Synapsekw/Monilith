import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createColumn,
  renameColumn,
  deleteColumn,
  resizeColumn,
} from "@/lib/boards/actions";

const BOARD = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const COL = "33333333-3333-4333-8333-333333333333";

beforeEach(() => from.mockReset());

describe("createColumn", () => {
  it("derives org from the board, appends after the last position, seeds defaults", async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: COL }, error: null }),
      }),
    });
    from.mockImplementation((t: string) => {
      if (t === "boards")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { org_id: ORG }, error: null }),
            }),
          }),
        };
      if (t === "columns")
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: { position: 2 },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          insert,
        };
      return {};
    });

    const res = await createColumn({ boardId: BOARD, kind: "status" });
    // Returns the full inserted row so the client inserts it optimistically
    // (mirrors createItem); Realtime echo de-dupes via insertColumn.
    expect(res).toEqual({ ok: true, data: { column: { id: COL } } });
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      org_id: ORG,
      board_id: BOARD,
      kind: "status",
      name: "Status",
    });
    expect(row.position).toBeGreaterThan(2); // appended after the last
    expect((row.settings as { options: unknown[] }).options).toHaveLength(3);
  });

  it("rejects an invalid kind before any db call", async () => {
    const res = await createColumn({
      boardId: BOARD,
      kind: "bogus" as never,
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("renameColumn / resizeColumn / deleteColumn", () => {
  function columnBoardLookup() {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { board_id: BOARD }, error: null }),
        }),
      }),
    };
  }

  it("renameColumn updates the name", async () => {
    const update = vi
      .fn()
      .mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) =>
      t === "columns" ? { ...columnBoardLookup(), update } : {},
    );
    const res = await renameColumn({ columnId: COL, name: "Priority" });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ name: "Priority" });
  });

  it("resizeColumn updates the width", async () => {
    const update = vi
      .fn()
      .mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) =>
      t === "columns" ? { ...columnBoardLookup(), update } : {},
    );
    const res = await resizeColumn({ columnId: COL, width: 320 });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ width: 320 });
  });

  it("resizeColumn rejects out-of-range widths", async () => {
    const res = await resizeColumn({ columnId: COL, width: 5000 });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("deleteColumn deletes the row", async () => {
    const del = vi.fn().mockReturnValue({ eq: async () => ({ error: null }) });
    from.mockImplementation((t: string) =>
      t === "columns" ? { ...columnBoardLookup(), delete: del } : {},
    );
    const res = await deleteColumn({ columnId: COL });
    expect(res.ok).toBe(true);
    expect(del).toHaveBeenCalled();
  });
});
