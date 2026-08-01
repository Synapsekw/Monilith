import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
const invalidateMyBoards = vi.fn();
const updateTag = vi.fn();
const revalidatePath = vi.fn();
const getBoardAccess = vi.fn();
const removeAttachmentObjects = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
  updateTag: (...a: unknown[]) => updateTag(...a),
}));
vi.mock("@/lib/boards/actions/internal", () => ({
  invalidateMyBoards: () => invalidateMyBoards(),
}));
vi.mock("@/lib/auth/session", () => ({ getUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/boards/queries", () => ({
  getBoardAccess: (...a: unknown[]) => getBoardAccess(...a),
}));
vi.mock("@/lib/collaboration/attachment-cleanup", () => ({
  removeAttachmentObjects: (...a: unknown[]) => removeAttachmentObjects(...a),
}));

import {
  createBoard,
  renameBoard,
  deleteBoard,
  archiveBoard,
  restoreBoard,
  purgeBoard,
} from "./board";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";

/** `.from("boards").update({…}).eq("id", …)` resolving to `{ error }`. */
function updateChain(error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn((_patch: Record<string, unknown>) => ({ eq }));
  return { chain: { update }, update, eq };
}

/** `.from("x").select("y").eq("z", …)` resolving to `{ data }`. */
function selectChain(data: unknown[] = []) {
  const eq = vi.fn().mockResolvedValue({ data });
  return { select: vi.fn(() => ({ eq })) };
}

/** `.from("boards").delete().eq("id", …)` resolving to `{ error }`. */
function deleteChain(error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  return { chain: { delete: vi.fn(() => ({ eq })) }, eq };
}

/**
 * purgeBoard's terminal chain:
 * `.delete().eq("id", …).not("archived_at", "is", null).select("id").maybeSingle()`.
 */
function purgeDeleteChain(result: { data?: unknown; error?: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  });
  const select = vi.fn(() => ({ maybeSingle }));
  const not = vi.fn(() => ({ select }));
  const eq = vi.fn(() => ({ not }));
  return { chain: { delete: vi.fn(() => ({ eq })) }, not, maybeSingle };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReset();
  from.mockReset();
  getBoardAccess.mockResolvedValue("owner");
  removeAttachmentObjects.mockResolvedValue(undefined);
});

describe("createBoard", () => {
  it("rejects an invalid workspace id without calling the RPC", async () => {
    const res = await createBoard({ workspaceId: "nope", name: "B" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_board and returns the new id", async () => {
    rpc.mockResolvedValue({ data: { id: "b1" }, error: null });
    const res = await createBoard({ workspaceId: WS_ID, name: "Roadmap" });
    expect(rpc).toHaveBeenCalledWith("create_board", {
      p_workspace_id: WS_ID,
      p_name: "Roadmap",
    });
    expect(res).toEqual({ ok: true, data: { boardId: "b1" } });
    expect(invalidateMyBoards).toHaveBeenCalled();
  });

  it("propagates the RPC error and does not invalidate the cache", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    const res = await createBoard({ workspaceId: WS_ID, name: "Roadmap" });
    expect(res).toEqual({ ok: false, error: "denied" });
    expect(invalidateMyBoards).not.toHaveBeenCalled();
  });
});

describe("renameBoard", () => {
  it("expires every board_members grantee's shared-boards tag", async () => {
    const { chain, update } = updateChain(null);
    from.mockImplementation((table: string) =>
      table === "boards"
        ? chain
        : selectChain([{ user_id: "u2" }, { user_id: "u3" }]),
    );
    const res = await renameBoard({ boardId: BOARD_ID, name: "New" });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ name: "New" });
    // One updateTag per grantee, plus the owner's own boards tag inside
    // invalidateMyBoards — which is mocked out, so only the fan-out lands here.
    expect(updateTag).toHaveBeenCalledTimes(2);
    expect(updateTag).toHaveBeenCalledWith("shared-boards:user:u2");
    expect(updateTag).toHaveBeenCalledWith("shared-boards:user:u3");
    expect(revalidatePath).toHaveBeenCalledWith(`/boards/${BOARD_ID}`);
  });

  it("propagates an update error before any tag work", async () => {
    const { chain } = updateChain({ message: "rls" });
    from.mockReturnValue(chain);
    const res = await renameBoard({ boardId: BOARD_ID, name: "New" });
    expect(res).toEqual({ ok: false, error: "rls" });
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an empty name without touching the database", async () => {
    const res = await renameBoard({ boardId: BOARD_ID, name: "   " });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("deleteBoard", () => {
  it("rejects an invalid board id before any access check or DB call", async () => {
    const res = await deleteBoard({ boardId: "nope" });
    expect(res.ok).toBe(false);
    expect(getBoardAccess).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses a non-owner without deleting anything", async () => {
    getBoardAccess.mockResolvedValue("editor");
    const res = await deleteBoard({ boardId: BOARD_ID });
    expect(res).toEqual({
      ok: false,
      error: "Only the board owner can delete this board.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("frees every attachment object after a successful delete", async () => {
    const { chain } = deleteChain(null);
    from.mockImplementation((table: string) =>
      table === "boards" ? chain : selectChain([{ storage_path: "a/1.png" }]),
    );
    const res = await deleteBoard({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(removeAttachmentObjects).toHaveBeenCalledWith(["a/1.png"]);
    expect(invalidateMyBoards).toHaveBeenCalled();
  });

  it("propagates a delete error and leaves storage untouched", async () => {
    const { chain } = deleteChain({ message: "fk violation" });
    from.mockImplementation((table: string) =>
      table === "boards" ? chain : selectChain([]),
    );
    const res = await deleteBoard({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: false, error: "fk violation" });
    expect(removeAttachmentObjects).not.toHaveBeenCalled();
    expect(invalidateMyBoards).not.toHaveBeenCalled();
  });
});

describe("archiveBoard", () => {
  it("rejects an invalid board id before any access check or DB call", async () => {
    const res = await archiveBoard({ boardId: "nope" });
    expect(res.ok).toBe(false);
    expect(getBoardAccess).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("stamps archived_at/archived_by and invalidates the board list", async () => {
    const { chain, update, eq } = updateChain(null);
    from.mockReturnValue(chain);
    const res = await archiveBoard({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({
      archived_at: expect.any(String),
      archived_by: "u1",
    });
    expect(eq).toHaveBeenCalledWith("id", BOARD_ID);
    expect(invalidateMyBoards).toHaveBeenCalled();
  });

  it("propagates a DB error as a typed failure", async () => {
    const { chain } = updateChain({ message: "rls" });
    from.mockReturnValue(chain);
    const res = await archiveBoard({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: false, error: "rls" });
    expect(invalidateMyBoards).not.toHaveBeenCalled();
  });
});

describe("restoreBoard", () => {
  it("rejects an invalid board id before any access check or DB call", async () => {
    const res = await restoreBoard({ boardId: "not-a-uuid" });
    expect(res.ok).toBe(false);
    expect(getBoardAccess).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses a non-owner", async () => {
    getBoardAccess.mockResolvedValue("viewer");
    const res = await restoreBoard({ boardId: BOARD_ID });
    expect(res).toEqual({
      ok: false,
      error: "Only the board owner can restore this board.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("clears both archive columns", async () => {
    const { chain, update } = updateChain(null);
    from.mockReturnValue(chain);
    const res = await restoreBoard({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({
      archived_at: null,
      archived_by: null,
    });
  });

  it("propagates a DB error as a typed failure", async () => {
    const { chain } = updateChain({ message: "rls" });
    from.mockReturnValue(chain);
    const res = await restoreBoard({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: false, error: "rls" });
    expect(invalidateMyBoards).not.toHaveBeenCalled();
  });
});

describe("purgeBoard", () => {
  it("rejects an invalid board id before any access check or DB call", async () => {
    const res = await purgeBoard({ boardId: "nope" });
    expect(res.ok).toBe(false);
    expect(getBoardAccess).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses a non-owner", async () => {
    getBoardAccess.mockResolvedValue("editor");
    const res = await purgeBoard({ boardId: BOARD_ID });
    expect(res).toEqual({
      ok: false,
      error: "Only the board owner can delete this board.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("only purges an archived board", async () => {
    const { chain, not } = purgeDeleteChain({ data: null });
    from.mockImplementation((table: string) =>
      table === "boards" ? chain : selectChain([]),
    );
    const res = await purgeBoard({ boardId: BOARD_ID });
    expect(not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(res).toEqual({
      ok: false,
      error: "Board not found or not archived.",
    });
    expect(removeAttachmentObjects).not.toHaveBeenCalled();
  });

  it("frees every attachment object after a successful purge", async () => {
    const { chain } = purgeDeleteChain({ data: { id: BOARD_ID } });
    from.mockImplementation((table: string) =>
      table === "boards"
        ? chain
        : selectChain([
            { storage_path: "a/1.png" },
            { storage_path: "b/2.pdf" },
          ]),
    );
    const res = await purgeBoard({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(removeAttachmentObjects).toHaveBeenCalledWith([
      "a/1.png",
      "b/2.pdf",
    ]);
    expect(invalidateMyBoards).toHaveBeenCalled();
  });

  it("propagates a DB error as a typed failure", async () => {
    const { chain } = purgeDeleteChain({ error: { message: "deadlock" } });
    from.mockImplementation((table: string) =>
      table === "boards" ? chain : selectChain([]),
    );
    const res = await purgeBoard({ boardId: BOARD_ID });
    expect(res).toEqual({ ok: false, error: "deadlock" });
    expect(removeAttachmentObjects).not.toHaveBeenCalled();
    expect(invalidateMyBoards).not.toHaveBeenCalled();
  });
});
