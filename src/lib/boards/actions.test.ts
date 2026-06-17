import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { upsertCell } from "@/lib/boards/actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COL = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
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
