import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser } }),
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
import { upsertCell } from "@/lib/boards/actions";
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
  sessionGetUser.mockReset().mockResolvedValue({ id: "owner-1" });
  updateTag.mockReset();
  vi.mocked(removeAttachmentObjects).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

describe("upsertCell people-cell assignment fan-out", () => {
  it("notifies only the newly-added member, excluding the actor", async () => {
    const notifInsert = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
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

    expect(res).toEqual({ ok: true, data: undefined });
    expect(upsert).toHaveBeenCalledTimes(1);
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
    const updateChain = {
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    from.mockImplementation((t: string) =>
      t === "boards" ? (updateChain as never) : ({} as never),
    );
    const res = await renameBoard({ boardId: BOARD, name: "New" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("boards:user:owner-1");
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
