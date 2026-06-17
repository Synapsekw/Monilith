import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser } }),
}));

import {
  addUpdate,
  deleteUpdate,
  markNotificationRead,
} from "@/lib/collaboration/actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const UPD = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
});

describe("addUpdate", () => {
  it("rejects invalid input without touching the db", async () => {
    const res = await addUpdate({ itemId: "bad", text: "" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("derives org/board from the item then inserts the update", async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: UPD }, error: null }),
      }),
    });
    from.mockImplementation((table: string) => {
      if (table === "items") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      }
      if (table === "item_updates") return { insert } as never;
      return {} as never;
    });
    const res = await addUpdate({ itemId: ITEM, text: "hello" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org",
        board_id: "board",
        item_id: ITEM,
        author_id: USER,
        body: { text: "hello", mentions: [] },
        body_text: "hello",
      }),
    );
    expect(res).toEqual({ ok: true, data: { updateId: UPD } });
  });

  it("fails when the item is not visible", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }));
    const res = await addUpdate({ itemId: ITEM, text: "hello" });
    expect(res).toEqual({ ok: false, error: "Item not found." });
  });
});

describe("deleteUpdate", () => {
  it("deletes by id and returns ok", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation(() => ({ delete: () => ({ eq }) }));
    const res = await deleteUpdate({ updateId: UPD });
    expect(eq).toHaveBeenCalledWith("id", UPD);
    expect(res).toEqual({ ok: true, data: undefined });
  });
});

describe("addUpdate mention fan-out", () => {
  const OTHER = "33333333-3333-4333-8333-333333333333";
  it("inserts one notification per mention, excluding the author", async () => {
    const notifInsert = vi.fn().mockResolvedValue({ error: null });
    const updInsert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: UPD }, error: null }),
      }),
    });
    from.mockImplementation((table: string) => {
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "item_updates") return { insert: updInsert } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });
    await addUpdate({
      itemId: ITEM,
      text: "hi @x @me",
      mentions: [OTHER, USER],
    });
    expect(notifInsert).toHaveBeenCalledTimes(1);
    expect(notifInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        org_id: "org",
        recipient_id: OTHER,
        actor_id: USER,
        kind: "mention",
        board_id: "board",
        item_id: ITEM,
        update_id: UPD,
      }),
    ]);
  });

  it("does not touch notifications when there are no mentions", async () => {
    const notifInsert = vi.fn();
    from.mockImplementation((table: string) => {
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "item_updates")
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: UPD }, error: null }),
            }),
          }),
        } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });
    await addUpdate({ itemId: ITEM, text: "no mentions" });
    expect(notifInsert).not.toHaveBeenCalled();
  });
});

describe("markNotificationRead", () => {
  it("updates read_at by id (RLS scopes to recipient)", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    from.mockImplementation(() => ({ update }) as never);
    const res = await markNotificationRead({ notificationId: UPD });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ read_at: expect.any(String) }),
    );
    expect(eq).toHaveBeenCalledWith("id", UPD);
    expect(res).toEqual({ ok: true, data: undefined });
  });
});
