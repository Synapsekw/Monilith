import { describe, expect, it, vi, beforeEach } from "vitest";
import { shareBoard, unshareBoard } from "./sharing-actions";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
const updateTag = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
  updateTag: (tag: string) => updateTag(tag),
}));
// The owner's own `boards:user:<me>` list (it carries the `shared_out` marker).
const invalidateMyBoards = vi.fn();
vi.mock("@/lib/boards/actions/internal", () => ({
  invalidateMyBoards: () => invalidateMyBoards(),
}));

beforeEach(() => {
  rpc.mockReset();
  updateTag.mockReset();
  revalidatePath.mockReset();
  invalidateMyBoards.mockReset();
});

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
    // The grantee's shared-boards list is what changed…
    expect(updateTag).toHaveBeenCalledWith(
      `shared-boards:user:${input.userId}`,
    );
    // …plus the owner's own list (its `shared_out` marker).
    expect(invalidateMyBoards).toHaveBeenCalledTimes(1);
    // Tags only: a `/boards` layout revalidation expires every cached read on
    // every board route, for every user.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("invalidates nothing when the RPC refuses", async () => {
    rpc.mockResolvedValue({ error: { message: "not the board owner" } });
    await shareBoard({
      boardId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      access: "viewer",
    });
    expect(updateTag).not.toHaveBeenCalled();
    expect(invalidateMyBoards).not.toHaveBeenCalled();
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
    expect(updateTag).toHaveBeenCalledWith(
      `shared-boards:user:${input.userId}`,
    );
    expect(invalidateMyBoards).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
