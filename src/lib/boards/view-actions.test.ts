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

  /**
   * Mock the view read (`.select("kind, board_id").eq(...).maybeSingle()`) and
   * the terminal `.update(...).eq(...)`.
   */
  function updateClient(opts: {
    view: { data: unknown; error: unknown };
    onUpdate?: (patch: unknown) => void;
    updateErr?: unknown;
  }) {
    return (table: string) => {
      if (table !== "board_views") return {} as never;
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => opts.view }) }),
        update: (patch: unknown) => ({
          eq: async () => {
            opts.onUpdate?.(patch);
            return { error: opts.updateErr ?? null };
          },
        }),
      } as never;
    };
  }

  it("updates the name and returns ok when the view exists", async () => {
    const onUpdate = vi.fn();
    from.mockImplementation(
      updateClient({
        view: { data: { kind: "table", board_id: BOARD_ID }, error: null },
        onUpdate,
      }),
    );
    const res = await updateBoardView({ viewId: VIEW_ID, name: "Renamed" });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onUpdate).toHaveBeenCalledWith({ name: "Renamed" });
  });

  it("fails when the view does not exist", async () => {
    from.mockImplementation(
      updateClient({ view: { data: null, error: null } }),
    );
    const res = await updateBoardView({ viewId: VIEW_ID, name: "X" });
    expect(res).toEqual({ ok: false, error: "View not found." });
  });

  it("applies a config patch on a kanban view", async () => {
    const onUpdate = vi.fn();
    from.mockImplementation(
      updateClient({
        view: { data: { kind: "kanban", board_id: BOARD_ID }, error: null },
        onUpdate,
      }),
    );
    const res = await updateBoardView({
      viewId: VIEW_ID,
      config: { group_column_id: null },
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onUpdate).toHaveBeenCalledWith({
      config: { group_column_id: null },
    });
  });

  it("rejects a non-empty config on a table view", async () => {
    const onUpdate = vi.fn();
    from.mockImplementation(
      updateClient({
        view: { data: { kind: "table", board_id: BOARD_ID }, error: null },
        onUpdate,
      }),
    );
    const res = await updateBoardView({
      viewId: VIEW_ID,
      config: { group_column_id: null },
    });
    expect(res.ok).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("applies a date_column_id config patch on a calendar view", async () => {
    const onUpdate = vi.fn();
    const DATE_COL_ID = "33333333-3333-4333-8333-333333333333";
    from.mockImplementation(
      updateClient({
        view: { data: { kind: "calendar", board_id: BOARD_ID }, error: null },
        onUpdate,
      }),
    );
    const res = await updateBoardView({
      viewId: VIEW_ID,
      config: { date_column_id: DATE_COL_ID },
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onUpdate).toHaveBeenCalledWith({
      config: { date_column_id: DATE_COL_ID },
    });
  });

  it("rejects a group_column_id config on a calendar view", async () => {
    const onUpdate = vi.fn();
    from.mockImplementation(
      updateClient({
        view: { data: { kind: "calendar", board_id: BOARD_ID }, error: null },
        onUpdate,
      }),
    );
    const res = await updateBoardView({
      viewId: VIEW_ID,
      config: { group_column_id: "some-id" },
    });
    expect(res.ok).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("applies a date_column_id + zoom config patch on a timeline view", async () => {
    const onUpdate = vi.fn();
    const DATE_COL_ID = "44444444-4444-4444-8444-444444444444";
    from.mockImplementation(
      updateClient({
        view: { data: { kind: "timeline", board_id: BOARD_ID }, error: null },
        onUpdate,
      }),
    );
    const res = await updateBoardView({
      viewId: VIEW_ID,
      config: { date_column_id: DATE_COL_ID, zoom: "month" },
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(onUpdate).toHaveBeenCalledWith({
      config: { date_column_id: DATE_COL_ID, zoom: "month" },
    });
  });

  it("rejects an invalid zoom value on a timeline view", async () => {
    const onUpdate = vi.fn();
    from.mockImplementation(
      updateClient({
        view: { data: { kind: "timeline", board_id: BOARD_ID }, error: null },
        onUpdate,
      }),
    );
    const res = await updateBoardView({
      viewId: VIEW_ID,
      config: { zoom: "day" },
    });
    expect(res.ok).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteBoardView", () => {
  it("rejects an invalid view id", async () => {
    const res = await deleteBoardView({ viewId: "nope" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  // New contract: deleteBoardView no longer pre-reads board_views for a
  // revalidatePath (the board client hydrates once and never refetches the RSC;
  // ViewSwitcher drives its own router.refresh()/push()). So there is no
  // `from("board_views")` read here — the RPC is the sole authority.
  it("surfaces the friendly invariant error from the RPC", async () => {
    rpc.mockResolvedValue({
      error: { message: "a board must keep at least one view" },
    });
    const res = await deleteBoardView({ viewId: VIEW_ID });
    expect(rpc).toHaveBeenCalledWith("delete_board_view", {
      p_view_id: VIEW_ID,
    });
    expect(from).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: false,
      error: "a board must keep at least one view",
    });
  });

  it("calls the delete_board_view RPC and returns ok", async () => {
    rpc.mockResolvedValue({ error: null });
    const res = await deleteBoardView({ viewId: VIEW_ID });
    expect(rpc).toHaveBeenCalledWith("delete_board_view", {
      p_view_id: VIEW_ID,
    });
    expect(from).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: undefined });
  });
});
