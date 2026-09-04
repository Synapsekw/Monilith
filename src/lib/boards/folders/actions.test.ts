import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => ({ id: "user-1" })),
}));

type EqCall = [string, unknown];

// Shared mutable state the actions read from (position lookups, forced errors,
// and how many rows a write matched).
//
// `affectedRows` is APPLIED, not merely recorded: `.maybeSingle()` below resolves
// `data: null` when it is 0, so a 0-row match genuinely changes what the action
// observes. A fake that only logged the number would let the not-found fix be
// deleted with the suite still green — gotcha-89.
const state: {
  insertError: unknown;
  maxPosition: number | null;
  affectedRows: number;
} = {
  insertError: null,
  maxPosition: null,
  affectedRows: 1,
};

// Every write the mocked client actually received, keyed by operation — this is
// what lets tests assert *what was sent*, not just that the action returned ok.
const calls: {
  inserts: unknown[];
  updates: { payload: unknown; eq: EqCall[] }[];
  deletes: { eq: EqCall[] }[];
  upserts: { payload: unknown; options: unknown }[];
} = { inserts: [], updates: [], deletes: [], upserts: [] };

/**
 * Chainable Supabase stub. `.eq()` both records the filter and returns the
 * same node, so it works mid-chain (`.select().eq().order().limit()`) and as
 * the terminal call (`.delete().eq(...)`). For that case the node is itself
 * thenable, resolving to `{ error }` and logging the operation only when it is
 * actually awaited.
 *
 * `.maybeSingle()` is the OTHER terminal — the RETURNING form
 * (`.update(...).eq(...).select("id").maybeSingle()`) that lets an action tell
 * "changed one row" from "matched nothing". It resolves `data: null` whenever
 * `state.affectedRows` is 0, so the fake APPLIES the row count rather than just
 * recording it; that is what makes the not-found tests genuinely fail without
 * the fix.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const eqLog: EqCall[] = [];
      let mode: "update" | "delete" | null = null;
      let updatePayload: unknown = null;
      let logged = false;

      // Exactly one of `.then` / `.maybeSingle` terminates a given chain, but
      // guard anyway: a double-log would silently break the `toHaveLength(1)`
      // assertions rather than the behaviour under test.
      const logOperation = () => {
        if (logged) return;
        logged = true;
        if (mode === "update") {
          calls.updates.push({ payload: updatePayload, eq: [...eqLog] });
        } else if (mode === "delete") {
          calls.deletes.push({ eq: [...eqLog] });
        }
      };

      const qb: Record<string, unknown> = {};
      qb.select = () => qb;
      qb.eq = (col: string, val: unknown) => {
        eqLog.push([col, val]);
        return qb;
      };
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
      qb.maybeSingle = () => {
        logOperation();
        return Promise.resolve({
          data: state.affectedRows > 0 ? { id: "matched-row" } : null,
          error: state.insertError,
        });
      };
      qb.insert = (payload: unknown) => {
        calls.inserts.push(payload);
        return qb;
      };
      qb.update = (payload: unknown) => {
        mode = "update";
        updatePayload = payload;
        return qb;
      };
      qb.delete = () => {
        mode = "delete";
        return qb;
      };
      qb.upsert = (payload: unknown, options: unknown) => {
        calls.upserts.push({ payload, options });
        return Promise.resolve({ error: state.insertError });
      };
      // Makes `qb` itself awaitable when `.eq()` is the last call in the
      // chain — `moveBoardToFolder`'s unfile delete has no RETURNING, so it
      // never reaches a distinct terminal method.
      qb.then = (resolve: (value: { error: unknown }) => void) => {
        logOperation();
        resolve({ error: state.insertError });
      };
      return qb;
    },
  })),
}));

import {
  createFolder,
  deleteFolder,
  moveBoardToFolder,
  renameFolder,
} from "./actions";

const BOARD = "11111111-1111-4111-8111-111111111111";
const FOLDER = "22222222-2222-4222-8222-222222222222";

describe("board folder actions", () => {
  beforeEach(() => {
    updateTag.mockClear();
    state.insertError = null;
    state.maxPosition = null;
    state.affectedRows = 1;
    calls.inserts = [];
    calls.updates = [];
    calls.deletes = [];
    calls.upserts = [];
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

  it("rejects an invalid folder id", async () => {
    const res = await deleteFolder({ folderId: "not-a-uuid" });
    expect(res.ok).toBe(false);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("invalidates only the board-folders tag on success", async () => {
    const res = await createFolder({ name: "Acme" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });

  it("renames a folder with the trimmed name and invalidates the tag", async () => {
    const res = await renameFolder({ folderId: FOLDER, name: "  New Name  " });
    expect(res.ok).toBe(true);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toMatchObject({
      payload: { name: "New Name" },
      eq: [["id", FOLDER]],
    });
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });

  it("deletes a folder filtered on its id and invalidates the tag", async () => {
    const res = await deleteFolder({ folderId: FOLDER });
    expect(res.ok).toBe(true);
    expect(calls.deletes).toHaveLength(1);
    expect(calls.deletes[0]).toEqual({ eq: [["id", FOLDER]] });
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });

  it("unfiles a board when folderId is null by issuing a delete", async () => {
    const res = await moveBoardToFolder({ boardId: BOARD, folderId: null });
    expect(res.ok).toBe(true);
    // A null target deletes the placement rather than upserting one.
    expect(calls.upserts).toHaveLength(0);
    expect(calls.deletes).toHaveLength(1);
    expect(calls.deletes[0]).toEqual({ eq: [["board_id", BOARD]] });
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });

  it("upserts on the (user_id, board_id) key when filing a board", async () => {
    const res = await moveBoardToFolder({ boardId: BOARD, folderId: FOLDER });
    expect(res.ok).toBe(true);
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0]?.payload).toMatchObject({
      user_id: "user-1",
      board_id: BOARD,
      folder_id: FOLDER,
    });
    // The conflict target is the entire mechanism enforcing "a board is in at
    // most one folder" — assert it explicitly, not just the row shape.
    expect(calls.upserts[0]?.options).toMatchObject({
      onConflict: "user_id,board_id",
    });
  });

  it("appends a new folder after the current highest position", async () => {
    state.maxPosition = 4;
    await createFolder({ name: "Beta" });
    expect(calls.inserts[0]).toMatchObject({ position: 5 });
  });

  it("appends a board placement after the current highest position in the folder", async () => {
    state.maxPosition = 4;
    await moveBoardToFolder({ boardId: BOARD, folderId: FOLDER });
    expect(calls.upserts[0]?.payload).toMatchObject({ position: 5 });
  });
});

/**
 * RLS filters a folder you do not own out of the statement entirely, so the
 * write succeeds having matched zero rows. Without a RETURNING check both
 * actions reported success for a folder that was deleted in another tab — the
 * user saw "renamed" and nothing had changed.
 *
 * The asymmetry with `moveBoardToFolder` is deliberate and is locked below, so a
 * future "make these consistent" refactor has to argue with a red test.
 */
describe("board folder actions — a 0-row match", () => {
  beforeEach(() => {
    updateTag.mockClear();
    state.insertError = null;
    state.maxPosition = null;
    state.affectedRows = 1;
    calls.inserts = [];
    calls.updates = [];
    calls.deletes = [];
    calls.upserts = [];
  });

  it("renameFolder reports a folder that isn't yours as missing", async () => {
    state.affectedRows = 0;
    const res = await renameFolder({ folderId: FOLDER, name: "New Name" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("That folder no longer exists.");
    // Nothing changed, so nothing may be invalidated.
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("deleteFolder reports a folder that isn't yours as missing", async () => {
    state.affectedRows = 0;
    const res = await deleteFolder({ folderId: FOLDER });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("That folder no longer exists.");
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("still renames and invalidates on a real match", async () => {
    state.affectedRows = 1;
    const res = await renameFolder({ folderId: FOLDER, name: "  New Name  " });
    expect(res.ok).toBe(true);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toMatchObject({
      payload: { name: "New Name" },
      eq: [["id", FOLDER]],
    });
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });

  it("still deletes and invalidates on a real match", async () => {
    state.affectedRows = 1;
    const res = await deleteFolder({ folderId: FOLDER });
    expect(res.ok).toBe(true);
    expect(calls.deletes).toHaveLength(1);
    expect(calls.deletes[0]).toEqual({ eq: [["id", FOLDER]] });
    expect(updateTag).toHaveBeenCalledTimes(1);
  });

  it("unfiling a board with no placement stays a success", async () => {
    state.affectedRows = 0;
    const res = await moveBoardToFolder({ boardId: BOARD, folderId: null });
    // A double-click, or a stale ⋯ menu, is a state the user already has —
    // failing it would surface an error toast for a no-op. Deliberately NOT
    // symmetric with rename/delete.
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("board-folders:user:user-1");
  });
});
