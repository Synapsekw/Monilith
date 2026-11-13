import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser } }),
}));
// The actor comes from the session helper (`getClaims()` — a LOCAL JWKS verify),
// never from `supabase.auth.getUser()` (a network round-trip to Supabase Auth
// on every call). `getUser` above is that network call: it stays wired into the
// client mock only so the tests can assert it is never reached.
const sessionGetUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getUser: () => sessionGetUser() }));

import {
  addUpdate,
  deleteUpdate,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/collaboration/actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const UPD = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  sessionGetUser.mockReset().mockResolvedValue({ id: USER });
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
    expect(res).toEqual({
      ok: true,
      data: { updateId: UPD },
    });
  });

  it("posts a body naming a former agent handle without querying user_agents", async () => {
    const fromSpy = from;
    fromSpy.mockImplementation((table: string) => {
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
      return {} as never;
    });
    const result = await addUpdate({ itemId: ITEM, text: "@ops take a look" });
    expect(fromSpy).not.toHaveBeenCalledWith("user_agents");
    expect(result).toEqual({
      ok: true,
      data: { updateId: expect.any(String) },
    });
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
  /** The item/item_updates/notifications triple every fan-out case needs. */
  function mockTables(notifInsert: ReturnType<typeof vi.fn>) {
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
  }
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
      mentions: [
        { kind: "user", userId: OTHER },
        { kind: "user", userId: USER },
      ],
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

  it("rejects more than 20 mentions before any insert", async () => {
    const notifInsert = vi.fn();
    mockTables(notifInsert);
    const res = await addUpdate({
      itemId: ITEM,
      text: "spam",
      mentions: Array.from({ length: 21 }, () => ({
        kind: "user" as const,
        userId: OTHER,
      })),
    });
    expect(res.ok).toBe(false);
    expect(notifInsert).not.toHaveBeenCalled();
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

  it("returns ok but logs when the mention notification insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifInsert = vi
      .fn()
      .mockResolvedValue({ error: { message: "insert denied" } });
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

    const res = await addUpdate({
      itemId: ITEM,
      text: "hi",
      mentions: [{ kind: "user", userId: OTHER }],
    });

    expect(res).toEqual({
      ok: true,
      data: { updateId: UPD },
    });
    expect(spy).toHaveBeenCalledWith(
      "[notifications] mention fan-out failed",
      expect.objectContaining({
        itemId: ITEM,
        recipients: 1,
        error: "insert denied",
      }),
    );
    spy.mockRestore();
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

describe("markAllNotificationsRead", () => {
  function unreadUpdateChain() {
    const is = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockReturnValue({ is });
    const update = vi.fn().mockReturnValue({ eq });
    from.mockImplementation(() => ({ update }) as never);
    return { update, eq, is };
  }

  it("marks the session user's unread rows read, with no Auth round-trip", async () => {
    const { update, eq, is } = unreadUpdateChain();
    const res = await markAllNotificationsRead();
    expect(res).toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ read_at: expect.any(String) }),
    );
    expect(eq).toHaveBeenCalledWith("recipient_id", USER);
    expect(is).toHaveBeenCalledWith("read_at", null);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("refuses when there is no session, without writing", async () => {
    sessionGetUser.mockResolvedValue(null);
    const { update } = unreadUpdateChain();
    const res = await markAllNotificationsRead();
    expect(res).toEqual({ ok: false, error: "Not authenticated." });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("addUpdate actor resolution", () => {
  it("refuses when there is no session, before reading the item", async () => {
    sessionGetUser.mockResolvedValue(null);
    const res = await addUpdate({ itemId: ITEM, text: "hi" });
    expect(res).toEqual({ ok: false, error: "Not authenticated." });
    expect(from).not.toHaveBeenCalled();
  });

  it("never makes the Supabase Auth network call to learn the author", async () => {
    // Posting a comment is a hot path; the author id is all it needs, and the
    // locally verified claims already carry it.
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }));
    await addUpdate({ itemId: ITEM, text: "hi" });
    expect(sessionGetUser).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
  });
});
