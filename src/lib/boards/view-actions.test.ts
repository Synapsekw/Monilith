import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createBoardView,
  updateBoardView,
  deleteBoardView,
} from "@/lib/boards/view-actions";

const BOARD_ID = "11111111-1111-4111-8111-111111111111";
const VIEW_ID = "22222222-2222-4222-8222-222222222222";

/**
 * Build a `from("board_views")` mock that distinguishes the two query chains the
 * delete guard issues by inspecting the args passed to `.select(...)`:
 *  - `.select("board_id").eq("id", …).maybeSingle()`        → the view read
 *  - `.select("id", { count, head }).eq("board_id", …)`     → the count probe
 *  - `.delete().eq("id", …)`                                → the delete itself
 */
function boardViewsClient(opts: {
  view: { data: unknown; error: unknown };
  count: { count: number | null; error: unknown };
  del?: { error: unknown };
  onDelete?: () => void;
}) {
  return (table: string) => {
    if (table !== "board_views") return {} as never;
    return {
      select: (_cols: string, options?: { count?: string; head?: boolean }) => {
        if (options?.count) {
          // Count probe: terminal is `.eq(...)` (awaited directly).
          return { eq: async () => opts.count };
        }
        // View read: `.eq(...).maybeSingle()`.
        return { eq: () => ({ maybeSingle: async () => opts.view }) };
      },
      delete: () => ({
        eq: async () => {
          opts.onDelete?.();
          return opts.del ?? { error: null };
        },
      }),
    } as never;
  };
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("createBoardView", () => {
  it("rejects an invalid board id without calling the RPC", async () => {
    const res = await createBoardView({ boardId: "nope", kind: "kanban" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("defaults the name by kind and calls create_board_view", async () => {
    rpc.mockResolvedValue({ data: { id: "v1" }, error: null });
    const res = await createBoardView({ boardId: BOARD_ID, kind: "kanban" });
    expect(rpc).toHaveBeenCalledWith(
      "create_board_view",
      expect.objectContaining({ p_name: "Kanban", p_board_id: BOARD_ID }),
    );
    expect(res).toEqual({ ok: true, data: { viewId: "v1" } });
  });

  it("uses an explicit name over the kind default", async () => {
    rpc.mockResolvedValue({ data: { id: "v9" }, error: null });
    await createBoardView({
      boardId: BOARD_ID,
      kind: "kanban",
      name: "My Board",
    });
    expect(rpc).toHaveBeenCalledWith(
      "create_board_view",
      expect.objectContaining({ p_name: "My Board" }),
    );
  });

  it("surfaces an RPC error as a typed failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await createBoardView({ boardId: BOARD_ID, kind: "table" });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});

describe("updateBoardView", () => {
  it("rejects an invalid view id", async () => {
    const res = await updateBoardView({ viewId: "nope", name: "X" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("is a no-op success when no fields are provided", async () => {
    const res = await updateBoardView({ viewId: VIEW_ID });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(from).not.toHaveBeenCalled();
  });

  it("updates and returns ok when the view exists", async () => {
    from.mockImplementation(
      (table: string) =>
        (table === "board_views"
          ? {
              update: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({
                      data: { board_id: BOARD_ID },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          : {}) as never,
    );
    const res = await updateBoardView({ viewId: VIEW_ID, name: "Renamed" });
    expect(res).toEqual({ ok: true, data: undefined });
  });
});

describe("deleteBoardView", () => {
  it("rejects an invalid view id", async () => {
    const res = await deleteBoardView({ viewId: "nope" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses to delete the board's last view", async () => {
    const onDelete = vi.fn();
    from.mockImplementation(
      boardViewsClient({
        view: { data: { board_id: BOARD_ID }, error: null },
        count: { count: 1, error: null },
        onDelete,
      }),
    );
    const res = await deleteBoardView({ viewId: VIEW_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/at least one view/i);
    // Guard must short-circuit before issuing the delete.
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("deletes when more than one view remains", async () => {
    const onDelete = vi.fn();
    from.mockImplementation(
      boardViewsClient({
        view: { data: { board_id: BOARD_ID }, error: null },
        count: { count: 2, error: null },
        onDelete,
      }),
    );
    const res = await deleteBoardView({ viewId: VIEW_ID });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("fails when the view does not exist", async () => {
    from.mockImplementation(
      boardViewsClient({
        view: { data: null, error: null },
        count: { count: 0, error: null },
      }),
    );
    const res = await deleteBoardView({ viewId: VIEW_ID });
    expect(res).toEqual({ ok: false, error: "View not found." });
  });
});
