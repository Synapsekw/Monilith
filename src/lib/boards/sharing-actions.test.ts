import { describe, expect, it, vi, beforeEach } from "vitest";
import { shareBoard, unshareBoard } from "./sharing-actions";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => rpc.mockReset());

describe("shareBoard", () => {
  it("rejects an invalid access level", async () => {
    const r = await shareBoard({
      boardId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      access: "admin" as never,
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid boardId", async () => {
    const r = await shareBoard({
      boardId: "nope",
      userId: crypto.randomUUID(),
      access: "viewer",
    });
    expect(r.ok).toBe(false);
  });

  it("calls share_board and returns ok on success", async () => {
    rpc.mockResolvedValue({ error: null });
    const input = {
      boardId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      access: "editor" as const,
    };
    const r = await shareBoard(input);
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("share_board", {
      p_board_id: input.boardId,
      p_user_id: input.userId,
      p_access: "editor",
    });
  });

  it("maps a permission error to friendly copy", async () => {
    rpc.mockResolvedValue({ error: { message: "not the board owner" } });
    const r = await shareBoard({
      boardId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      access: "viewer",
    });
    expect(r).toEqual({
      ok: false,
      error: "Only the board owner can manage sharing.",
    });
  });
});

describe("unshareBoard", () => {
  it("calls unshare_board on valid input", async () => {
    rpc.mockResolvedValue({ error: null });
    const input = { boardId: crypto.randomUUID(), userId: crypto.randomUUID() };
    const r = await unshareBoard(input);
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("unshare_board", {
      p_board_id: input.boardId,
      p_user_id: input.userId,
    });
  });
});
