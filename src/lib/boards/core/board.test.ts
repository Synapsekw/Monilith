import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  updateTag: (...a: unknown[]) => updateTag(...a),
}));

beforeEach(() => {
  updateTag.mockClear();
});

import {
  archiveBoardCore,
  createBoardCore,
  duplicateBoardCore,
  renameBoardCore,
  restoreBoardCore,
} from "./board";

const OWNER = "owner-1";
const OTHER = "other-1";
const BOARD_ID = "b1";

/**
 * A fake client that answers `getBoardAccessCore`'s two reads for real
 * (`boards.created_by`, then `board_members.access_level`), so these tests
 * exercise the ACTUAL owner-only guard rather than a stubbed access level —
 * that guard, and its exact refusal message, is the load-bearing behaviour
 * carried over from `deleteBoard` (spec F4 / decision D5).
 */
function fakeClient(opts: {
  createdBy: string | null;
  memberAccess?: "editor" | "viewer";
  updateError?: { message: string } | null;
  rpc?: { data: unknown; error: { message: string } | null };
  memberIds?: string[];
}) {
  const updateEq = vi.fn().mockResolvedValue({
    error: opts.updateError ?? null,
  });
  const update = vi.fn(() => ({ eq: updateEq }));
  const rpc = vi
    .fn()
    .mockResolvedValue(opts.rpc ?? { data: { id: "dup-1" }, error: null });

  const client = {
    rpc,
    from(table: string) {
      if (table === "boards") {
        return {
          select: (cols: string) => {
            if (cols === "created_by") {
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data:
                      opts.createdBy === null
                        ? null
                        : { created_by: opts.createdBy },
                    error: null,
                  }),
                }),
              };
            }
            throw new Error(`unexpected boards.select(${cols})`);
          },
          update,
        };
      }
      if (table === "board_members") {
        return {
          select: (cols: string) => {
            if (cols === "access_level") {
              return {
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: opts.memberAccess
                        ? { access_level: opts.memberAccess }
                        : null,
                      error: null,
                    }),
                  }),
                }),
              };
            }
            if (cols === "user_id") {
              return {
                eq: async () => ({
                  data: (opts.memberIds ?? []).map((id) => ({ user_id: id })),
                }),
              };
            }
            throw new Error(`unexpected board_members.select(${cols})`);
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, update, updateEq, rpc };
}

describe("archiveBoardCore", () => {
  it("refuses a non-owner with the exact deleteBoard-parity message", async () => {
    const { client, update } = fakeClient({
      createdBy: OTHER,
      memberAccess: "editor",
    });
    const r = await archiveBoardCore(client, OWNER, { boardId: BOARD_ID });
    expect(r).toEqual({
      ok: false,
      error: "Only the board owner can delete this board.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a non-member (no access at all)", async () => {
    const { client } = fakeClient({ createdBy: OTHER });
    const r = await archiveBoardCore(client, OWNER, { boardId: BOARD_ID });
    expect(r).toEqual({
      ok: false,
      error: "Only the board owner can delete this board.",
    });
  });

  it("stamps archived_at/archived_by for the owner", async () => {
    const { client, update } = fakeClient({ createdBy: OWNER });
    const r = await archiveBoardCore(client, OWNER, { boardId: BOARD_ID });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({
      archived_at: expect.any(String),
      archived_by: OWNER,
    });
  });
});

describe("restoreBoardCore", () => {
  it("refuses a non-owner with the restore-specific message", async () => {
    const { client } = fakeClient({ createdBy: OTHER, memberAccess: "viewer" });
    const r = await restoreBoardCore(client, OWNER, { boardId: BOARD_ID });
    expect(r).toEqual({
      ok: false,
      error: "Only the board owner can restore this board.",
    });
  });

  it("clears both archive columns for the owner", async () => {
    const { client, update } = fakeClient({ createdBy: OWNER });
    const r = await restoreBoardCore(client, OWNER, { boardId: BOARD_ID });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({
      archived_at: null,
      archived_by: null,
    });
  });
});

describe("duplicateBoardCore", () => {
  it("fails with 'Board not found.' for a non-member", async () => {
    const { client, rpc } = fakeClient({ createdBy: OTHER });
    const r = await duplicateBoardCore(client, OWNER, { boardId: BOARD_ID });
    expect(r).toEqual({ ok: false, error: "Board not found." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows any member (editor/viewer), not just the owner", async () => {
    const { client, rpc } = fakeClient({
      createdBy: OTHER,
      memberAccess: "viewer",
    });
    const r = await duplicateBoardCore(client, OWNER, { boardId: BOARD_ID });
    expect(r).toEqual({ ok: true, data: { boardId: "dup-1" } });
    expect(rpc).toHaveBeenCalledWith("duplicate_board_structure", {
      p_board_id: BOARD_ID,
    });
  });
});

describe("createBoardCore", () => {
  it("calls create_board and returns the new id", async () => {
    const { client, rpc } = fakeClient({
      createdBy: OWNER,
      rpc: { data: { id: "new-board" }, error: null },
    });
    const r = await createBoardCore(client, {
      workspaceId: "w1",
      name: "Roadmap",
    });
    expect(r).toEqual({ ok: true, data: { boardId: "new-board" } });
    expect(rpc).toHaveBeenCalledWith("create_board", {
      p_workspace_id: "w1",
      p_name: "Roadmap",
    });
  });

  it("propagates the RPC error", async () => {
    const { client } = fakeClient({
      createdBy: OWNER,
      rpc: { data: null, error: { message: "denied" } },
    });
    const r = await createBoardCore(client, { workspaceId: "w1", name: "X" });
    expect(r).toEqual({ ok: false, error: "denied" });
  });
});

describe("renameBoardCore", () => {
  it("updates the name and expires every grantee's shared-boards tag", async () => {
    const { client, update } = fakeClient({
      createdBy: OWNER,
      memberIds: ["u2", "u3"],
    });
    const r = await renameBoardCore(client, { boardId: BOARD_ID, name: "New" });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({ name: "New" });
    expect(updateTag).toHaveBeenCalledWith("shared-boards:user:u2");
    expect(updateTag).toHaveBeenCalledWith("shared-boards:user:u3");
  });

  it("propagates an update error before any tag work", async () => {
    const { client } = fakeClient({
      createdBy: OWNER,
      updateError: { message: "rls" },
    });
    const r = await renameBoardCore(client, { boardId: BOARD_ID, name: "New" });
    expect(r).toEqual({ ok: false, error: "rls" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
