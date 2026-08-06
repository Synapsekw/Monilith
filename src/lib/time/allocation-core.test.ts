import { describe, expect, it, vi } from "vitest";
import { upsertTimeAllocationCore } from "./allocation-core";

// The core writes through the `upsert_time_allocation` RPC, not
// `.upsert(…, { onConflict })`: the table's unique indexes are PARTIAL and
// PostgREST's `on_conflict=` cannot carry their WHERE predicate, so every
// `.upsert()` failed at plan time with 42P10 (migration 20260806060855).
function fakeClient(
  result: { data: number | null; error: { message: string } | null } = {
    data: 3600,
    error: null,
  },
) {
  const rpc = vi.fn(
    async (_fn: string, _args: Record<string, unknown>) => result,
  );
  return { client: { rpc }, rpc };
}

describe("upsertTimeAllocationCore", () => {
  it("calls the RPC with the item key and lets the RPC derive the board", async () => {
    const { client, rpc } = fakeClient({ data: 3600, error: null });
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
    expect(rpc).toHaveBeenCalledWith("upsert_time_allocation", {
      p_org_id: "o1",
      p_work_date: "2026-01-01",
      p_duration_secs: 3600,
      p_item_id: "i1",
      p_board_id: "b1",
      p_category: null,
      p_note: null,
    });
  });

  it("never sends a user id — the RPC derives it from auth.uid()", async () => {
    const { client, rpc } = fakeClient();
    await upsertTimeAllocationCore(
      client as never,
      { workDate: "2026-01-01", itemId: "i1", durationSecs: 3600 },
      { userId: "u1", orgId: "o1" },
    );

    const args = rpc.mock.calls[0]![1];
    expect(Object.values(args)).not.toContain("u1");
    // board omitted on the item path => null, so the RPC derives it
    expect(args.p_board_id).toBeNull();
  });

  it("calls the RPC with the category key and no board", async () => {
    const { client, rpc } = fakeClient({ data: 900, error: null });
    await upsertTimeAllocationCore(
      client as never,
      { workDate: "2026-01-01", category: "Admin", durationSecs: 900 },
      { userId: "u1", orgId: "o1" },
    );

    expect(rpc).toHaveBeenCalledWith(
      "upsert_time_allocation",
      expect.objectContaining({
        p_item_id: null,
        p_board_id: null,
        p_category: "Admin",
        p_duration_secs: 900,
      }),
    );
  });

  it("reports 0 seconds when the RPC cleared the cell (returns null)", async () => {
    const { client } = fakeClient({ data: null, error: null });
    const res = await upsertTimeAllocationCore(
      client as never,
      { workDate: "2026-01-01", category: "Admin", durationSecs: 0 },
      { userId: "u1", orgId: "o1" },
    );
    expect(res).toEqual({ ok: true, data: { durationSecs: 0 } });
  });

  it("returns a failure result on a DB error", async () => {
    const { client } = fakeClient({ data: null, error: { message: "denied" } });
    const res = await upsertTimeAllocationCore(
      client as never,
      { workDate: "2026-01-01", category: "Admin", durationSecs: 900 },
      { userId: "u1", orgId: "o1" },
    );
    expect(res).toEqual({ ok: false, error: "denied" });
  });
});
