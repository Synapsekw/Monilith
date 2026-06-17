import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser } }),
}));

import { addUpdate, deleteUpdate } from "@/lib/collaboration/actions";

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
        body: { text: "hello" },
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
