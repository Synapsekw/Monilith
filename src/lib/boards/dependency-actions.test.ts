import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createDependency,
  deleteDependency,
  getBoardDependencyContext,
  editableBoardIds,
} from "@/lib/boards/dependency-actions";

const PRED_ID = "11111111-1111-4111-8111-111111111111";
const SUCC_ID = "22222222-2222-4222-8222-222222222222";
const DEP_ID = "33333333-3333-4333-8333-333333333333";
const BOARD_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("createDependency", () => {
  it("rejects invalid ids without calling rpc", async () => {
    const res = await createDependency({
      predecessorId: "not-a-uuid",
      successorId: SUCC_ID,
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_item_dependency rpc and returns the created row", async () => {
    const row = {
      id: DEP_ID,
      org_id: "55555555-5555-4555-8555-555555555555",
      board_id: BOARD_ID,
      predecessor_board_id: BOARD_ID,
      predecessor_id: PRED_ID,
      successor_id: SUCC_ID,
      type: "finish_to_start",
      created_at: "2026-11-14T00:00:00Z",
    };
    rpc.mockResolvedValue({ data: row, error: null });
    const res = await createDependency({
      predecessorId: PRED_ID,
      successorId: SUCC_ID,
    });
    expect(rpc).toHaveBeenCalledWith("create_item_dependency", {
      p_predecessor: PRED_ID,
      p_successor: SUCC_ID,
    });
    expect(res).toEqual({ ok: true, data: { dependency: row } });
  });

  it("returns ok:false on rpc error, mapped to user copy", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "this would create a dependency cycle" },
    });
    const res = await createDependency({
      predecessorId: PRED_ID,
      successorId: SUCC_ID,
    });
    expect(res).toEqual({
      ok: false,
      error: "That would create a dependency loop.",
    });
  });

  it("names the other board, not 'this board', when edit access is missing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "no edit access to this board" },
    });
    const res = await createDependency({
      predecessorId: PRED_ID,
      successorId: SUCC_ID,
    });
    expect(res).toEqual({
      ok: false,
      error: "You can't edit the board that item is on.",
    });
  });
});

describe("deleteDependency", () => {
  it("rejects an invalid dependency id without calling from", async () => {
    const res = await deleteDependency({ dependencyId: "bad-id" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("reads board_id then deletes and returns ok", async () => {
    const deleteSelect = vi
      .fn()
      .mockResolvedValue({ data: [{ id: DEP_ID }], error: null });
    const deleteEq = vi.fn(() => ({ select: deleteSelect }));
    from.mockImplementation((table: string) => {
      if (table === "item_dependencies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { board_id: BOARD_ID },
                error: null,
              }),
            }),
          }),
          delete: () => ({ eq: deleteEq }),
        } as never;
      }
      return {} as never;
    });
    const res = await deleteDependency({ dependencyId: DEP_ID });
    expect(deleteEq).toHaveBeenCalledWith("id", DEP_ID);
    expect(deleteSelect).toHaveBeenCalledWith("id");
    expect(res).toEqual({ ok: true, data: undefined });
  });

  it("fails when RLS lets the delete through but removes no row", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { board_id: BOARD_ID },
            error: null,
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }));
    const res = await deleteDependency({ dependencyId: DEP_ID });
    expect(res).toEqual({
      ok: false,
      error: "You can't remove this dependency.",
    });
  });

  it("returns ok:false when dependency is not found", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      delete: () => ({ eq: vi.fn() }),
    }));
    const res = await deleteDependency({ dependencyId: DEP_ID });
    expect(res).toEqual({ ok: false, error: "Dependency not found." });
  });

  it("returns ok:false when the delete fails", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { board_id: BOARD_ID },
            error: null,
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "delete failed" },
          }),
        }),
      }),
    }));
    const res = await deleteDependency({ dependencyId: DEP_ID });
    expect(res).toEqual({
      ok: false,
      error: "Couldn't remove the dependency.",
    });
  });
});

describe("getBoardDependencyContext", () => {
  it("rejects a non-uuid board id", async () => {
    const res = await getBoardDependencyContext({ boardId: "nope" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns parsed context", async () => {
    rpc.mockResolvedValueOnce({ data: { boards: [], items: [] }, error: null });
    const res = await getBoardDependencyContext({
      boardId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res).toEqual({ ok: true, data: { boards: [], items: [] } });
    expect(rpc).toHaveBeenCalledWith("board_dependency_context", {
      p_board_id: "11111111-1111-4111-8111-111111111111",
    });
  });
  it("maps rpc errors to a failure", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "board not found", code: "P0002" },
    });
    const res = await getBoardDependencyContext({
      boardId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res).toEqual({ ok: false, error: "Couldn't load linked items." });
  });
  it("fails on a malformed payload", async () => {
    rpc.mockResolvedValueOnce({ data: { boards: "x" }, error: null });
    const res = await getBoardDependencyContext({
      boardId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res).toEqual({ ok: false, error: "Couldn't load linked items." });
  });
});

describe("editableBoardIds", () => {
  const OTHER = "55555555-5555-4555-8555-555555555555";

  it("returns the editable subset, one check per distinct board", async () => {
    rpc.mockImplementation(async (_fn: string, args: { p_board_id: string }) =>
      args.p_board_id === BOARD_ID
        ? { data: true, error: null }
        : { data: false, error: null },
    );
    const res = await editableBoardIds({
      boardIds: [BOARD_ID, BOARD_ID, OTHER],
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("can_edit_board", { p_board_id: OTHER });
    expect(res).toEqual({ ok: true, data: [BOARD_ID] });
  });

  it("treats a failed check as not editable", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await editableBoardIds({ boardIds: [OTHER] })).toEqual({
      ok: true,
      data: [],
    });
  });

  it("rejects bad or unbounded input without calling rpc", async () => {
    expect((await editableBoardIds({ boardIds: ["nope"] })).ok).toBe(false);
    expect((await editableBoardIds({ boardIds: [] })).ok).toBe(false);
    expect(
      (await editableBoardIds({ boardIds: Array(26).fill(OTHER) })).ok,
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
