import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getFolderAccessHead } from "./sharing-queries";
import { FOLDER_ACCESS_HEAD_LIMIT } from "./sharing-types";

function client(opts: {
  members: { data: { user_id: string }[] | null; count: number | null };
  manage: { data: boolean | null };
}) {
  const limit = vi.fn(async () => ({ ...opts.members, error: null }));
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ limit }) }) }),
    }),
    rpc: async () => ({ ...opts.manage, error: null }),
  } as unknown as SupabaseClient<Database>;
  return { supabase, limit };
}

describe("getFolderAccessHead", () => {
  it("returns the ids, the exact count and the manage flag", async () => {
    const { supabase } = client({
      members: { data: [{ user_id: "a" }, { user_id: "b" }], count: 7 },
      manage: { data: true },
    });
    expect(await getFolderAccessHead(supabase, "f")).toEqual({
      count: 7,
      memberIds: ["a", "b"],
      canManage: true,
    });
  });

  it("falls back to the row count when the exact count is missing", async () => {
    const { supabase } = client({
      members: { data: [{ user_id: "a" }], count: null },
      manage: { data: false },
    });
    expect((await getFolderAccessHead(supabase, "f")).count).toBe(1);
  });

  it("degrades to nobody and cannot-manage on a failed read", async () => {
    const { supabase } = client({
      members: { data: null, count: null },
      manage: { data: null },
    });
    expect(await getFolderAccessHead(supabase, "f")).toEqual({
      count: 0,
      memberIds: [],
      canManage: false,
    });
  });

  it("caps the member read at 50", async () => {
    const { supabase, limit } = client({
      members: { data: [], count: 0 },
      manage: { data: false },
    });
    await getFolderAccessHead(supabase, "f");
    expect(FOLDER_ACCESS_HEAD_LIMIT).toBe(50);
    expect(limit).toHaveBeenCalledWith(50);
  });
});
