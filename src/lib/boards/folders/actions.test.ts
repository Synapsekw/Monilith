import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => ({ id: "user-1" })),
}));

// Minimal chainable stub: every terminal awaits to { data, error }.
const state: {
  insertError: unknown;
  upsertPayload: unknown;
  maxPosition: number | null;
} = { insertError: null, upsertPayload: null, maxPosition: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const qb: Record<string, unknown> = {};
      qb.select = () => qb;
      qb.eq = () => qb;
      qb.order = () => qb;
      qb.limit = () =>
        Promise.resolve({
          data:
            state.maxPosition === null ? [] : [{ position: state.maxPosition }],
          error: null,
        });
      qb.single = () =>
        Promise.resolve({
          data: { id: "f-new", name: "Acme", position: 0 },
          error: state.insertError,
        });
      qb.insert = () => qb;
      qb.update = () => Promise.resolve({ error: state.insertError });
      qb.delete = () => qb;
      qb.upsert = (payload: unknown) => {
        state.upsertPayload = payload;
        return Promise.resolve({ error: state.insertError });
      };
      return qb;
    },
  })),
}));

import { createFolder, moveBoardToFolder, renameFolder } from "./actions";

const BOARD = "11111111-1111-4111-8111-111111111111";
const FOLDER = "22222222-2222-4222-8222-222222222222";

describe("board folder actions", () => {
  beforeEach(() => {
    updateTag.mockClear();
    state.insertError = null;
    state.upsertPayload = null;
    state.maxPosition = null;
  });

  it("rejects an empty folder name before touching the database", async () => {
    const res = await createFolder({ name: "   " });
    expect(res.ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("rejects a name over 60 characters", async () => {
    const res = await renameFolder({ folderId: FOLDER, name: "x".repeat(61) });
    expect(res.ok).toBe(false);
  });

  it("invalidates only the board-folders tag on success", async () => {
    const res = await createFolder({ name: "Acme" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });

  it("unfiles a board when folderId is null", async () => {
    const res = await moveBoardToFolder({ boardId: BOARD, folderId: null });
    expect(res.ok).toBe(true);
    // A null target deletes the placement rather than upserting one.
    expect(state.upsertPayload).toBeNull();
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });

  it("upserts on the (user_id, board_id) key when filing a board", async () => {
    const res = await moveBoardToFolder({ boardId: BOARD, folderId: FOLDER });
    expect(res.ok).toBe(true);
    expect(state.upsertPayload).toMatchObject({
      user_id: "user-1",
      board_id: BOARD,
      folder_id: FOLDER,
    });
  });
});
