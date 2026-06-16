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

  it("calls create_item_dependency rpc with correct args on success", async () => {
    rpc.mockResolvedValue({
      data: { id: DEP_ID, board_id: BOARD_ID },
      error: null,
    });
    const res = await createDependency({
      predecessorId: PRED_ID,
      successorId: SUCC_ID,
    });
    expect(rpc).toHaveBeenCalledWith("create_item_dependency", {
      p_predecessor: PRED_ID,
      p_successor: SUCC_ID,
    });
    expect(res).toEqual({ ok: true, data: { dependencyId: DEP_ID } });
  });

  it("returns ok:false on rpc error, passing the message through", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "this would create a dependency cycle" },
    });
    const res = await createDependency({
      predecessorId: PRED_ID,
      successorId: SUCC_ID,
    });
    expect(res).toEqual({
      ok: false,
      error: "this would create a dependency cycle",
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
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
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
    expect(res).toEqual({ ok: true, data: undefined });
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
        eq: vi.fn().mockResolvedValue({ error: { message: "delete failed" } }),
      }),
    }));
    const res = await deleteDependency({ dependencyId: DEP_ID });
    expect(res).toEqual({ ok: false, error: "delete failed" });
  });
});
