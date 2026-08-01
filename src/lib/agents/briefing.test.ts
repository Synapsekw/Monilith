import { describe, it, expect, vi } from "vitest";
import { applyBoardScope, buildBriefing } from "./briefing";
import type { MyWorkItem } from "@/lib/my-work/bucket";

const item = (over: Partial<MyWorkItem> = {}): MyWorkItem => ({
  itemId: "i1",
  itemName: "Ship it",
  boardId: "b1",
  boardName: "Sprint 24",
  groupName: null,
  status: null,
  dueDate: null,
  ...over,
});

describe("applyBoardScope", () => {
  it("passes everything through in all-boards mode", () => {
    const items = [item(), item({ itemId: "i2", boardId: "b2" })];
    expect(applyBoardScope(items, { mode: "all" })).toHaveLength(2);
  });

  it("keeps only listed boards in list mode", () => {
    const items = [item(), item({ itemId: "i2", boardId: "b2" })];
    const r = applyBoardScope(items, { mode: "list", boardIds: ["b2"] });
    expect(r.map((i) => i.itemId)).toEqual(["i2"]);
  });
});

describe("buildBriefing", () => {
  function clientWith(rows: unknown[]) {
    return { rpc: vi.fn().mockResolvedValue({ data: rows, error: null }) };
  }

  it("counts overdue, today and this week", async () => {
    const client = clientWith([
      {
        item_id: "a",
        item_name: "Late",
        board_id: "b1",
        board_name: "Sprint 24",
        group_name: null,
        status_option_id: null,
        status_settings: null,
        due_date: "2026-07-30",
      },
      {
        item_id: "b",
        item_name: "Due now",
        board_id: "b1",
        board_name: "Sprint 24",
        group_name: null,
        status_option_id: null,
        status_settings: null,
        due_date: "2026-08-01",
      },
      {
        item_id: "c",
        item_name: "Later this week",
        board_id: "b1",
        board_name: "Sprint 24",
        group_name: null,
        status_option_id: null,
        status_settings: null,
        // 2026-08-01 is a Saturday; with the bucket.ts Monday-start week this
        // is the only date that falls after today and on/before the week's
        // end (2026-08-02, per endOfWeek), landing in the "week" bucket
        // rather than "later".
        due_date: "2026-08-02",
      },
    ]);

    const brief = await buildBriefing(
      client as never,
      { mode: "all" },
      "2026-08-01",
    );

    expect(brief.totals.overdue).toBe(1);
    expect(brief.totals.today).toBe(1);
    expect(brief.totals.week).toBe(1);
    expect(brief.today).toBe("2026-08-01");
  });

  it("calls the RPC with the bounded limit", async () => {
    const client = clientWith([]);
    await buildBriefing(client as never, { mode: "all" }, "2026-08-01");
    expect(client.rpc).toHaveBeenCalledWith("get_my_work_items", {
      p_limit: 500,
    });
  });

  it("returns empty totals when the owner has nothing assigned", async () => {
    const client = clientWith([]);
    const brief = await buildBriefing(
      client as never,
      { mode: "all" },
      "2026-08-01",
    );
    expect(brief.groups).toEqual([]);
    expect(brief.totals).toEqual({ overdue: 0, today: 0, week: 0 });
  });

  it("throws when the RPC errors — never silently sends an empty briefing", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "rls" } }),
    };
    await expect(
      buildBriefing(client as never, { mode: "all" }, "2026-08-01"),
    ).rejects.toThrow(/rls/);
  });
});
