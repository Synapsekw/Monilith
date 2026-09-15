import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { resolveFolderAttention, resolveFolderRollup } from "./resolve";

function clientWith(rpc: (fn: string, args: unknown) => unknown) {
  return { rpc: vi.fn(rpc) } as unknown as SupabaseClient<Database>;
}

describe("resolveFolderRollup", () => {
  it("calls folder_rollup and camel-cases the row", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          board_id: "b1",
          board_name: "Backend",
          board_position: 0,
          group_id: "g1",
          group_name: "Build",
          group_color: "#111",
          group_position: 1,
          total: 6,
          done: 3,
          in_progress: 2,
          overdue: 1,
          not_started: 0,
          blocked: 1,
          stale: 0,
          unassigned: 0,
          incomplete: 1,
          planned_by_today: 4,
          due_this_week: 2,
          due_this_week_not_started: 1,
          oldest_overdue: "2026-09-01",
          min_due: "2026-08-24",
          max_due: "2026-09-25",
        },
      ],
      error: null,
    }));
    const res = await resolveFolderRollup(client, "f1");
    expect(client.rpc).toHaveBeenCalledWith("folder_rollup", {
      p_folder_id: "f1",
    });
    expect(res).toEqual({
      ok: true,
      rows: [
        {
          boardId: "b1",
          boardName: "Backend",
          boardPosition: 0,
          groupId: "g1",
          groupName: "Build",
          groupColor: "#111",
          groupPosition: 1,
          total: 6,
          done: 3,
          inProgress: 2,
          overdue: 1,
          notStarted: 0,
          blocked: 1,
          stale: 0,
          unassigned: 0,
          incomplete: 1,
          plannedByToday: 4,
          dueThisWeek: 2,
          dueThisWeekNotStarted: 1,
          oldestOverdue: "2026-09-01",
          minDue: "2026-08-24",
          maxDue: "2026-09-25",
        },
      ],
    });
  });

  it("surfaces the RPC error message", async () => {
    const client = clientWith(async () => ({
      data: null,
      error: { message: "not authorized" },
    }));
    expect(await resolveFolderRollup(client, "f1")).toEqual({
      ok: false,
      error: "not authorized",
    });
  });
});

describe("resolveFolderAttention", () => {
  it("passes the limit and narrows the reason", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          item_id: "i",
          item_name: "x",
          board_id: "b",
          board_name: "B",
          group_id: null,
          group_name: null,
          reason: "overdue",
          age_days: 3,
          severity: 4,
        },
      ],
      error: null,
    }));
    const res = await resolveFolderAttention(client, "f1", 5);
    expect(client.rpc).toHaveBeenCalledWith("folder_attention", {
      p_folder_id: "f1",
      p_limit: 5,
    });
    expect(res.ok && res.rows[0].reason).toBe("overdue");
  });

  it("drops a row whose reason is not one of the four", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          item_id: "i",
          item_name: "x",
          board_id: "b",
          board_name: "B",
          group_id: null,
          group_name: null,
          reason: "weird",
          age_days: 3,
          severity: 4,
        },
      ],
      error: null,
    }));
    const res = await resolveFolderAttention(client, "f1");
    expect(res).toEqual({ ok: true, rows: [] });
  });
});
