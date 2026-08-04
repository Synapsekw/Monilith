import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser }, rpc }),
}));
const getBoardAccess = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardAccess: (...a: unknown[]) => getBoardAccess(...a),
}));
const sessionGetUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getUser: () => sessionGetUser() }));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: (tag: string) => updateTag(tag),
}));
vi.mock("@/lib/collaboration/attachment-cleanup", () => ({
  removeAttachmentObjects: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { clearCell, upsertCell } from "@/lib/boards/actions";
import { removeAttachmentObjects } from "@/lib/collaboration/attachment-cleanup";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COL = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  rpc.mockReset();
  // Default to owner so pre-existing tests that reach the new membership
  // checks keep exercising their original paths.
  getBoardAccess.mockReset().mockResolvedValue("owner");
  sessionGetUser.mockReset().mockResolvedValue({ id: "owner-1" });
  updateTag.mockReset();
  vi.mocked(removeAttachmentObjects).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

describe("upsertCell people-cell assignment fan-out", () => {
  it("notifies only the newly-added member, excluding the actor", async () => {
    sessionGetUser.mockResolvedValue({ id: USER });
    const notifInsert = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn((row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => ({ data: row, error: null }),
      }),
    }));
    from.mockImplementation((table: string) => {
      if (table === "columns")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board", kind: "people" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "cell_values")
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { value: { userIds: [A] } },
                  error: null,
                }),
              }),
            }),
          }),
          upsert,
        } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });

    // prior = [A]; new = [A, B, USER] → only B is a fresh non-actor recipient.
    const res = await upsertCell({
      itemId: ITEM,
      columnId: COL,
      value: { userIds: [A, B, USER] },
    });

    expect(res.ok).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    // New contract: a cell edit is the hottest board mutation and must NOT
    // revalidate the board RSC — the mounted client hydrates once and is kept
    // fresh by optimistic patches + Realtime, so revalidatePath here would
    // re-run 9 queries the client discards. (Nav/sidebar surfaces are covered by
    // updateTag on board create/delete/rename, not by this path.)
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(notifInsert).toHaveBeenCalledTimes(1);
    expect(notifInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        org_id: "org",
        recipient_id: B,
        actor_id: USER,
        kind: "assigned",
        board_id: "board",
        item_id: ITEM,
      }),
    ]);
  });

  it("returns ok but logs when the notification insert fails", async () => {
    sessionGetUser.mockResolvedValue({ id: USER });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifInsert = vi
      .fn()
      .mockResolvedValue({ error: { message: "insert denied" } });
    const upsert = vi.fn((row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => ({ data: row, error: null }),
      }),
    }));
    from.mockImplementation((table: string) => {
      if (table === "columns")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board", kind: "people" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "cell_values")
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          upsert,
        } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });

    const res = await upsertCell({
      itemId: ITEM,
      columnId: COL,
      value: { userIds: [A] },
    });

    expect(res.ok).toBe(true); // primary write not failed
    expect(spy).toHaveBeenCalledWith(
      "[notifications] assigned fan-out failed",
      expect.objectContaining({
        itemId: ITEM,
        recipients: 1,
        error: "insert denied",
      }),
    );
    spy.mockRestore();
  });

  it("clearCell on a people column never notifies (removal is not an 'assigned' event)", async () => {
    const notifInsert = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => {
      if (table === "columns")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "cell_values")
        return {
          delete: () => ({ eq: () => ({ eq: del }) }),
        } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });

    const res = await clearCell({ itemId: ITEM, columnId: COL });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(del).toHaveBeenCalledTimes(1);
    expect(notifInsert).not.toHaveBeenCalled();
  });
});

import { buildTemplatePayload } from "@/lib/boards/template-payload";
import { getTemplate } from "@/lib/boards/templates";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("buildTemplatePayload", () => {
  it("blank: 1 group, 3 columns, 0 items; all ids are uuids", () => {
    const p = buildTemplatePayload(getTemplate("blank")!);
    expect(p.groups).toHaveLength(1);
    expect(p.columns).toHaveLength(3);
    expect(p.items).toHaveLength(0);
    expect(p.groups[0].id).toMatch(UUID_RE);
    expect(p.columns.every((c) => UUID_RE.test(c.id))).toBe(true);
    expect(p.groups[0].position).toBe(0);
  });

  it("status column carries options with minted uuid ids", () => {
    const p = buildTemplatePayload(getTemplate("blank")!);
    const status = p.columns.find((c) => c.kind === "status")!;
    const opts = (status.settings as { options: { id: string }[] }).options;
    expect(opts).toHaveLength(4);
    expect(opts.every((o) => UUID_RE.test(o.id))).toBe(true);
  });

  it("resolves a status cell to the matching minted optionId", () => {
    const p = buildTemplatePayload(getTemplate("sprints")!);
    const status = p.columns.find((c) => c.name === "Status")!;
    const doneId = (
      status.settings as { options: { id: string; label: string }[] }
    ).options.find((o) => o.label === "Done")!.id;
    const shipItem = p.items.find((i) => i.name === "Ship settings page")!;
    const statusCell = shipItem.cells.find((c) => c.columnId === status.id)!;
    expect(statusCell.value).toEqual({ optionId: doneId });
  });

  it("resolves a date range cell to ISO start + end", () => {
    const p = buildTemplatePayload(getTemplate("sprints")!);
    const sprintCol = p.columns.find((c) => c.name === "Sprint")!;
    const item = p.items.find((i) => i.name === "Build onboarding flow")!;
    const cell = item.cells.find((c) => c.columnId === sprintCol.id)!;
    const v = cell.value as { date: string; end: string };
    expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.end > v.date).toBe(true);
  });

  it("resolves dropdown, numbers and text cells", () => {
    const p = buildTemplatePayload(getTemplate("content")!);
    const channel = p.columns.find((c) => c.name === "Channel")!;
    const item = p.items.find((i) => i.name === "Launch thread")!;
    const cell = item.cells.find((c) => c.columnId === channel.id)!;
    const ids = (cell.value as { optionIds: string[] }).optionIds;
    expect(ids).toHaveLength(1);
    expect(UUID_RE.test(ids[0])).toBe(true);
  });
});

import { createBoardFromTemplate } from "@/lib/boards/actions";

describe("createBoardFromTemplate", () => {
  it("rejects an unknown templateId before touching Supabase", async () => {
    const res = await createBoardFromTemplate({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      templateId: "does-not-exist",
      name: "My board",
    });
    expect(res).toEqual({ ok: false, error: "Unknown template." });
  });
});

import {
  addSubitem,
  deleteBoard,
  deleteItem,
  reorderBoard,
  reorderItem,
} from "./actions";

const SUB = "33333333-3333-4333-8333-333333333333";
const BOARD = "44444444-4444-4444-8444-444444444444";

describe("addSubitem", () => {
  it("rejects an empty name", async () => {
    const res = await addSubitem({
      parentId: "11111111-1111-1111-1111-111111111111",
      name: " ",
    });
    expect(res.ok).toBe(false);
  });
  it("rejects a non-uuid parentId", async () => {
    const res = await addSubitem({ parentId: "nope", name: "Sub" });
    expect(res.ok).toBe(false);
  });
});

describe("deleteItem", () => {
  it("rejects a non-uuid itemId", async () => {
    const res = await deleteItem({ itemId: "nope" });
    expect(res.ok).toBe(false);
  });

  it("removes attachment objects for the item and its subitems", async () => {
    let queriedIds: string[] = [];
    from.mockImplementation((table: string) => {
      if (table === "items")
        return {
          // subitem-id gather: from("items").select("id").eq("parent_id", X)
          select: () => ({
            eq: async () => ({ data: [{ id: SUB }], error: null }),
          }),
          // delete: from("items").delete().eq("id", X).select("board_id").maybeSingle()
          delete: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: { board_id: BOARD },
                  error: null,
                }),
              }),
            }),
          }),
        } as never;
      if (table === "attachments")
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => {
              queriedIds = ids;
              return {
                data: [
                  { storage_path: "o/b/i/1.png" },
                  { storage_path: "o/b/s/2.png" },
                ],
                error: null,
              };
            },
          }),
        } as never;
      return {} as never;
    });

    const res = await deleteItem({ itemId: ITEM });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(queriedIds).toContain(ITEM);
    expect(queriedIds).toContain(SUB);
    expect(removeAttachmentObjects).toHaveBeenCalledWith([
      "o/b/i/1.png",
      "o/b/s/2.png",
    ]);
  });

  it("does not remove objects when the item is not found", async () => {
    from.mockImplementation((table: string) => {
      if (table === "items")
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          delete: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        } as never;
      if (table === "attachments")
        return {
          select: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        } as never;
      return {} as never;
    });

    const res = await deleteItem({ itemId: ITEM });

    expect(res.ok).toBe(false);
    expect(removeAttachmentObjects).not.toHaveBeenCalled();
  });
});

describe("deleteBoard", () => {
  it("rejects a non-uuid boardId", async () => {
    const res = await deleteBoard({ boardId: "nope" });
    expect(res.ok).toBe(false);
  });

  it("removes every attachment object on the board", async () => {
    from.mockImplementation((table: string) => {
      if (table === "attachments")
        return {
          select: () => ({
            eq: async () => ({
              data: [{ storage_path: "o/b/i/1.png" }],
              error: null,
            }),
          }),
        } as never;
      if (table === "boards")
        return {
          delete: () => ({ eq: async () => ({ error: null }) }),
        } as never;
      return {} as never;
    });

    const res = await deleteBoard({ boardId: BOARD });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(removeAttachmentObjects).toHaveBeenCalledWith(["o/b/i/1.png"]);
  });
});

describe("board membership checks (defense in depth — RLS stays the boundary)", () => {
  it("deleteBoard refuses non-owners without touching the db", async () => {
    getBoardAccess.mockResolvedValue("editor");
    const res = await deleteBoard({ boardId: BOARD });
    expect(res).toEqual({
      ok: false,
      error: "Only the board owner can delete this board.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("deleteBoard proceeds for the owner", async () => {
    getBoardAccess.mockResolvedValue("owner");
    const del = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    from.mockImplementation((table: string) => {
      if (table === "attachments")
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        } as never;
      if (table === "boards") return { delete: del } as never;
      return {} as never;
    });
    const res = await deleteBoard({ boardId: BOARD });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(del).toHaveBeenCalled();
  });

  it("duplicateBoard refuses non-members with a non-leaking message", async () => {
    getBoardAccess.mockResolvedValue(null);
    const res = await duplicateBoard({ boardId: BOARD });
    expect(res).toEqual({ ok: false, error: "Board not found." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("duplicateBoard proceeds for a viewer", async () => {
    getBoardAccess.mockResolvedValue("viewer");
    rpc.mockResolvedValue({ data: { id: "new-board" }, error: null });
    const res = await duplicateBoard({ boardId: BOARD });
    expect(res).toEqual({ ok: true, data: { boardId: "new-board" } });
    expect(rpc).toHaveBeenCalledWith("duplicate_board_structure", {
      p_board_id: BOARD,
    });
  });
});

describe("reorderItem", () => {
  it("rejects a non-uuid itemId", async () => {
    const res = await reorderItem({ itemId: "nope", position: 1 });
    expect(res.ok).toBe(false);
  });
});

describe("reorderBoard", () => {
  it("rejects a non-uuid boardId before touching Supabase", async () => {
    const res = await reorderBoard({ boardId: "nope", position: 1 });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("updates position scoped to the current user's own board", async () => {
    const update = vi.fn(() => ({ eq: eq1 }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const eq2 = vi.fn(() => ({ select: selectFn }));
    const selectFn = vi.fn(() => ({ maybeSingle }));
    const maybeSingle = vi.fn(async () => ({
      data: { id: BOARD },
      error: null,
    }));
    from.mockImplementation((table: string) => {
      if (table === "boards") return { update } as never;
      return {} as never;
    });

    const res = await reorderBoard({ boardId: BOARD, position: 3.5 });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({ position: 3.5 });
    expect(eq1).toHaveBeenCalledWith("id", BOARD);
    expect(eq2).toHaveBeenCalledWith("created_by", USER);
  });

  it("does NOT revalidate the layout on success (would reload the shell)", async () => {
    // Reorder is optimistic in the sidebar and the new position is persisted,
    // so it must not bust the shared (app) layout cache — that reloads the whole
    // sidebar on the next navigation. Contrast: deleteBoard still revalidates.
    const maybeSingle = vi.fn(async () => ({
      data: { id: BOARD },
      error: null,
    }));
    from.mockImplementation((table: string) => {
      if (table === "boards")
        return {
          update: () => ({
            eq: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }),
          }),
        } as never;
      return {} as never;
    });

    const res = await reorderBoard({ boardId: BOARD, position: 2 });

    expect(res.ok).toBe(true);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("fails when no row matches (board owned by someone else)", async () => {
    from.mockImplementation((table: string) => {
      if (table === "boards")
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        } as never;
      return {} as never;
    });

    const res = await reorderBoard({ boardId: BOARD, position: 1 });
    expect(res.ok).toBe(false);
  });
});

import { moveItem } from "./actions";

const GROUP = "55555555-5555-4555-8555-555555555555";

const MOVED_SUB = "77777777-7777-4777-8777-777777777777";

/**
 * The move UPDATE is awaited two ways: the item's own update reads the row back
 * (`.select("*").maybeSingle()`) so an RLS-blocked write can't pass as success,
 * while the subitem fan-out awaits `.select("id")` for the ids it moved. One
 * thenable whose `select()` is BOTH awaitable and `.maybeSingle()`-able serves
 * both. `row: null` = the RLS-hidden write (0 rows, no error).
 */
const moveUpdateResult = (
  row: Record<string, unknown> | null,
  subitems: { id: string }[] = [],
) =>
  Object.assign(Promise.resolve({ error: null }), {
    select: () =>
      Object.assign(Promise.resolve({ data: subitems, error: null }), {
        maybeSingle: async () => ({ data: row, error: null }),
      }),
  });

/** The reads every moveItem case makes before the UPDATE: the item is top-level
 *  on BOARD, the target group is on the same board, and that group's last
 *  top-level row sits at position 2 (so an append lands at midpoint(2, null)). */
function mockMoveTables(update: ReturnType<typeof vi.fn>) {
  from.mockImplementation((table: string) => {
    if (table === "items")
      return {
        select: (cols: string) => {
          if (cols === "board_id, parent_id")
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: { board_id: BOARD, parent_id: null },
                  error: null,
                }),
              }),
            };
          // last top-level item in target group: select("position")...maybeSingle()
          return {
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { position: 2 },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        },
        update,
      } as never;
    if (table === "groups")
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { board_id: BOARD },
              error: null,
            }),
          }),
        }),
      } as never;
    return {} as never;
  });
}

describe("moveItem", () => {
  it("uses the provided position instead of appending", async () => {
    const update = vi.fn(() => ({ eq: () => moveUpdateResult({ id: ITEM }) }));
    mockMoveTables(update);

    const res = await moveItem({
      itemId: ITEM,
      groupId: GROUP,
      position: 3.5,
    });

    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: GROUP, position: 3.5 }),
    );
  });

  it("still appends when position is omitted", async () => {
    // last top-level item in target group has position 2 → append = midpoint(2, null) = 3
    const update = vi.fn(() => ({ eq: () => moveUpdateResult({ id: ITEM }) }));
    mockMoveTables(update);

    const res = await moveItem({ itemId: ITEM, groupId: GROUP });

    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: GROUP, position: 3 }),
    );
  });

  it("returns the moved row and the ids of the subitems dragged along", async () => {
    // The caller needs the authoritative post-move row (and the subitems whose
    // denormalized group_id came with it) to patch a mounted board without a
    // refetch. Both come back from UPDATEs already being issued.
    const update = vi.fn(() => ({
      eq: () =>
        moveUpdateResult({ id: ITEM, group_id: GROUP, position: 3 }, [
          { id: MOVED_SUB },
        ]),
    }));
    mockMoveTables(update);

    const res = await moveItem({ itemId: ITEM, groupId: GROUP });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.item.id).toBe(ITEM);
    expect(res.data.item.group_id).toBe(GROUP);
    expect(res.data.subitemIds).toEqual([MOVED_SUB]);
  });

  it("reports no subitems when the fan-out returns nothing", async () => {
    // Best-effort by design: the parent already moved, so a subitem UPDATE that
    // returns nothing must still be a successful move with an empty id list.
    const update = vi.fn(() => ({
      eq: () => moveUpdateResult({ id: ITEM, group_id: GROUP }),
    }));
    mockMoveTables(update);

    const res = await moveItem({ itemId: ITEM, groupId: GROUP });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.subitemIds).toEqual([]);
  });

  it("fails instead of reporting success when RLS silently blocks the update", async () => {
    // A viewer can READ the board (so both pre-checks pass) but cannot update
    // items: the UPDATE matches zero rows and returns NO error. Without reading
    // the row back, the AI thread would say "Done" for a move that never
    // happened — and drag-and-drop would fail just as silently.
    const update = vi.fn(() => ({ eq: () => moveUpdateResult(null) }));
    mockMoveTables(update);

    const res = await moveItem({ itemId: ITEM, groupId: GROUP });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/permission/i);
    // the subitem fan-out must not run once the parent move was refused
    expect(update).toHaveBeenCalledTimes(1);
  });
});

import {
  archiveItem,
  restoreItem,
  archiveGroup,
  restoreGroup,
  archiveBoard,
  restoreBoard,
  purgeBoard,
  purgeGroup,
  purgeItem,
} from "./actions";

const GRP = "66666666-6666-4666-8666-666666666666";

describe("archive / restore (RPC-backed cascade)", () => {
  it("archiveItem calls archive_item RPC and never touches from()/delete", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    const res = await archiveItem({ itemId: ITEM });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("archive_item", { p_item_id: ITEM });
    expect(from).not.toHaveBeenCalled();
  });

  it("archiveItem rejects a non-uuid id before touching Supabase", async () => {
    const res = await archiveItem({ itemId: "nope" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("archiveItem surfaces an RPC error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await archiveItem({ itemId: ITEM });
    expect(res).toEqual({ ok: false, error: "boom" });
  });

  it("restoreItem calls restore_item RPC", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    const res = await restoreItem({ itemId: ITEM });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("restore_item", { p_item_id: ITEM });
  });

  it("archiveGroup calls archive_group RPC", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const res = await archiveGroup({ groupId: GRP });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("archive_group", { p_group_id: GRP });
    expect(from).not.toHaveBeenCalled();
  });

  it("restoreGroup calls restore_group RPC", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const res = await restoreGroup({ groupId: GRP });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("restore_group", { p_group_id: GRP });
  });
});

describe("archiveBoard / restoreBoard (owner-guarded O(1) row update)", () => {
  it("archiveBoard blocks a non-owner without touching the db", async () => {
    getBoardAccess.mockResolvedValue("editor");
    const res = await archiveBoard({ boardId: BOARD });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("archiveBoard (owner) sets archived_at/by + invalidates boards tag", async () => {
    getBoardAccess.mockResolvedValue("owner");
    const eq = vi.fn().mockResolvedValue({ error: null });
    let updatePayload: Record<string, unknown> = {};
    const update = vi.fn((p: Record<string, unknown>) => {
      updatePayload = p;
      return { eq };
    });
    from.mockImplementation(
      (t: string) => (t === "boards" ? { update } : {}) as never,
    );
    const res = await archiveBoard({ boardId: BOARD });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_by: "owner-1" }),
    );
    expect(updatePayload.archived_at).toBeTruthy();
    expect(eq).toHaveBeenCalledWith("id", BOARD);
    expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
  });

  it("restoreBoard (owner) clears archived_at/by + invalidates", async () => {
    getBoardAccess.mockResolvedValue("owner");
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockImplementation(
      (t: string) => (t === "boards" ? { update } : {}) as never,
    );
    const res = await restoreBoard({ boardId: BOARD });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith({
      archived_at: null,
      archived_by: null,
    });
    expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
  });

  it("restoreBoard blocks a non-owner", async () => {
    getBoardAccess.mockResolvedValue("viewer");
    const res = await restoreBoard({ boardId: BOARD });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("purge (permanent, archived-only, storage cleanup)", () => {
  it("purgeBoard blocks a non-owner without touching the db", async () => {
    getBoardAccess.mockResolvedValue("editor");
    const res = await purgeBoard({ boardId: BOARD });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("purgeBoard hard-deletes an archived board and frees storage", async () => {
    getBoardAccess.mockResolvedValue("owner");
    const not = vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: { id: BOARD }, error: null }),
      }),
    }));
    const del = vi.fn(() => ({ eq: () => ({ not }) }));
    from.mockImplementation((t: string) => {
      if (t === "attachments")
        return {
          select: () => ({
            eq: async () => ({
              data: [{ storage_path: "o/b/i/1.png" }],
              error: null,
            }),
          }),
        } as never;
      if (t === "boards") return { delete: del } as never;
      return {} as never;
    });
    const res = await purgeBoard({ boardId: BOARD });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(del).toHaveBeenCalled();
    expect(not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(removeAttachmentObjects).toHaveBeenCalledWith(["o/b/i/1.png"]);
  });

  it("purgeBoard fails when the board is not archived (0 rows)", async () => {
    getBoardAccess.mockResolvedValue("owner");
    const not = vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }));
    const del = vi.fn(() => ({ eq: () => ({ not }) }));
    from.mockImplementation((t: string) => {
      if (t === "attachments")
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        } as never;
      if (t === "boards") return { delete: del } as never;
      return {} as never;
    });
    const res = await purgeBoard({ boardId: BOARD });
    expect(res.ok).toBe(false);
    expect(removeAttachmentObjects).not.toHaveBeenCalled();
  });

  it("purgeItem hard-deletes an archived item + subitem storage", async () => {
    const not = vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: { board_id: BOARD }, error: null }),
      }),
    }));
    from.mockImplementation((t: string) => {
      if (t === "items")
        return {
          select: () => ({
            eq: async () => ({ data: [{ id: SUB }], error: null }),
          }),
          delete: () => ({ eq: () => ({ not }) }),
        } as never;
      if (t === "attachments")
        return {
          select: () => ({
            in: async () => ({
              data: [{ storage_path: "o/b/i/1.png" }],
              error: null,
            }),
          }),
        } as never;
      return {} as never;
    });
    const res = await purgeItem({ itemId: ITEM });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(removeAttachmentObjects).toHaveBeenCalledWith(["o/b/i/1.png"]);
  });

  it("purgeItem fails when the item is not archived", async () => {
    const not = vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }));
    from.mockImplementation((t: string) => {
      if (t === "items")
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          delete: () => ({ eq: () => ({ not }) }),
        } as never;
      if (t === "attachments")
        return {
          select: () => ({ in: async () => ({ data: [], error: null }) }),
        } as never;
      return {} as never;
    });
    const res = await purgeItem({ itemId: ITEM });
    expect(res.ok).toBe(false);
    expect(removeAttachmentObjects).not.toHaveBeenCalled();
  });

  it("purgeGroup frees its items' storage then cascade-deletes archived group", async () => {
    const not = vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: { board_id: BOARD }, error: null }),
      }),
    }));
    const del = vi.fn(() => ({ eq: () => ({ not }) }));
    let attachmentIds: string[] = [];
    from.mockImplementation((t: string) => {
      if (t === "items")
        return {
          select: () => ({
            eq: async () => ({ data: [{ id: ITEM }], error: null }),
          }),
        } as never;
      if (t === "attachments")
        return {
          select: () => ({
            in: async (_c: string, ids: string[]) => {
              attachmentIds = ids;
              return { data: [{ storage_path: "o/b/g/1.png" }], error: null };
            },
          }),
        } as never;
      if (t === "groups") return { delete: del } as never;
      return {} as never;
    });
    const res = await purgeGroup({ groupId: GRP });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(attachmentIds).toContain(ITEM);
    expect(del).toHaveBeenCalled();
    expect(not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(removeAttachmentObjects).toHaveBeenCalledWith(["o/b/g/1.png"]);
  });

  it("purgeGroup fails when the group is not archived", async () => {
    const not = vi.fn(() => ({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }));
    const del = vi.fn(() => ({ eq: () => ({ not }) }));
    from.mockImplementation((t: string) => {
      if (t === "items")
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        } as never;
      if (t === "attachments")
        return {
          select: () => ({ in: async () => ({ data: [], error: null }) }),
        } as never;
      if (t === "groups") return { delete: del } as never;
      return {} as never;
    });
    const res = await purgeGroup({ groupId: GRP });
    expect(res.ok).toBe(false);
    expect(removeAttachmentObjects).not.toHaveBeenCalled();
  });
});

import {
  createBoard,
  renameBoard,
  duplicateBoard,
  createBoardFromTemplate as createBoardFromTemplateInval,
} from "./actions";

describe("board mutation invalidation (boards tag)", () => {
  it("createBoard updates the owner's boards tag", async () => {
    from.mockReturnValue({});
    const rpc = vi.fn(async () => ({ data: { id: "b1" }, error: null }));
    // createBoard uses createClient().rpc — patch the client for this test.
    vi.mocked(revalidatePath).mockClear();
    const client = { rpc, from, auth: { getUser } };
    const mod = await import("@/lib/supabase/server");
    vi.spyOn(mod, "createClient").mockResolvedValue(client as never);

    const res = await createBoard({ workspaceId: BOARD, name: "B" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
  });

  it("renameBoard updates the owner's boards tag", async () => {
    from.mockImplementation((t: string) => {
      if (t === "boards")
        return {
          update: () => ({ eq: async () => ({ error: null }) }),
        } as never;
      if (t === "board_members")
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        } as never;
      return {} as never;
    });
    const res = await renameBoard({ boardId: BOARD, name: "New" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
  });

  it("renameBoard invalidates every recipient's shared-boards tag", async () => {
    from.mockImplementation((t: string) => {
      if (t === "boards")
        return {
          update: () => ({ eq: async () => ({ error: null }) }),
        } as never;
      if (t === "board_members")
        return {
          select: () => ({
            eq: async () => ({
              data: [{ user_id: A }, { user_id: B }],
              error: null,
            }),
          }),
        } as never;
      return {} as never;
    });

    const res = await renameBoard({ boardId: BOARD, name: "New" });

    expect(res.ok).toBe(true);
    // Owner's own list is still invalidated (via invalidateMyBoards).
    expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
    // Each grantee's shared-boards list is invalidated so the rename shows up
    // for them immediately instead of after the nav TTL.
    expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${A}`);
    expect(updateTag).toHaveBeenCalledWith(`shared-boards:user:${B}`);
  });

  it("deleteBoard updates the owner's boards tag", async () => {
    from.mockImplementation((table: string) => {
      if (table === "attachments")
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        } as never;
      if (table === "boards")
        return {
          delete: () => ({ eq: async () => ({ error: null }) }),
        } as never;
      return {} as never;
    });
    const res = await deleteBoard({ boardId: BOARD });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
  });

  it("duplicateBoard updates the owner's boards tag", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "copy" }, error: null }));
    const client = { rpc, from, auth: { getUser } };
    const mod = await import("@/lib/supabase/server");
    vi.spyOn(mod, "createClient").mockResolvedValue(client as never);
    const res = await duplicateBoard({ boardId: BOARD });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
  });

  it("createBoardFromTemplate updates the owner's boards tag", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "tpl" }, error: null }));
    const client = { rpc, from, auth: { getUser } };
    const mod = await import("@/lib/supabase/server");
    vi.spyOn(mod, "createClient").mockResolvedValue(client as never);
    const res = await createBoardFromTemplateInval({
      workspaceId: BOARD,
      templateId: "blank",
      name: "From template",
    });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
  });
});
