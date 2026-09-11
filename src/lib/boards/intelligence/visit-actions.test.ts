import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

import { touchBoardVisit } from "./visit-actions";

const BOARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => rpc.mockReset());

describe("touchBoardVisit", () => {
  it("rejects a non-uuid board id before touching the database", async () => {
    const res = await touchBoardVisit("not-a-uuid");
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls touch_board_visit with the board id and reports ok", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await touchBoardVisit(BOARD);
    expect(res).toEqual({ ok: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("touch_board_visit", {
      p_board_id: BOARD,
    });
  });

  it("surfaces an RPC error as a failed result (never throws)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const res = await touchBoardVisit(BOARD);
    expect(res).toEqual({ ok: false, error: "permission denied" });
  });
});
