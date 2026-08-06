import { describe, expect, it, vi } from "vitest";
import { upsertTimeAllocationCore } from "./allocation-core";

function fakeClient(error: { message: string } | null = null) {
  const upsert = vi.fn(async () => ({ error }));
  return { client: { from: () => ({ upsert }) }, upsert };
}

describe("upsertTimeAllocationCore", () => {
  it("upserts on the item key when an itemId is given", async () => {
    const { client, upsert } = fakeClient();
    const res = await upsertTimeAllocationCore(
      client as never,
      {
        workDate: "2026-01-01",
        itemId: "i1",
        boardId: "b1",
        durationSecs: 3600,
      },
      { userId: "u1", orgId: "o1" },
    );

    expect(res).toEqual({ ok: true, data: { durationSecs: 3600 } });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "o1",
        user_id: "u1",
        work_date: "2026-01-01",
        item_id: "i1",
        board_id: "b1",
        category: null,
        duration_secs: 3600,
      }),
      { onConflict: "user_id,work_date,item_id" },
    );
  });

  it("upserts on the category key when no itemId is given", async () => {
    const { client, upsert } = fakeClient();
    await upsertTimeAllocationCore(
      client as never,
      { workDate: "2026-01-01", category: "Admin", durationSecs: 900 },
      { userId: "u1", orgId: "o1" },
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: null,
        board_id: null,
        category: "Admin",
      }),
      { onConflict: "user_id,work_date,category" },
    );
  });

  it("returns a failure result on a DB error", async () => {
    const { client } = fakeClient({ message: "denied" });
    const res = await upsertTimeAllocationCore(
      client as never,
      { workDate: "2026-01-01", category: "Admin", durationSecs: 900 },
      { userId: "u1", orgId: "o1" },
    );
    expect(res).toEqual({ ok: false, error: "denied" });
  });
});
