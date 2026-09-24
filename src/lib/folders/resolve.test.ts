import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  resolveFolderAttention,
  resolveFolderBurn,
  resolveFolderGallery,
  resolveFolderRollup,
  resolveFolderWorkload,
} from "./resolve";
import { FOLDER_DATA_ERROR, FOLDER_GONE_ERROR } from "./types";

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

  it("maps a P0002 (not-found / not-a-member) RPC error to FOLDER_GONE_ERROR", async () => {
    const client = clientWith(async () => ({
      data: null,
      error: { code: "P0002", message: "folder not found" },
    }));
    expect(await resolveFolderRollup(client, "f1")).toEqual({
      ok: false,
      error: FOLDER_GONE_ERROR,
    });
  });

  it("never forwards raw Postgres error text — any other error maps to a generic message", async () => {
    const client = clientWith(async () => ({
      data: null,
      error: { message: "not authorized" },
    }));
    expect(await resolveFolderRollup(client, "f1")).toEqual({
      ok: false,
      error: FOLDER_DATA_ERROR,
    });
  });

  it("rejects a row whose shape doesn't match folder_rollup's returns table", async () => {
    const client = clientWith(async () => ({
      data: [{ board_id: "b1" /* every other required column missing */ }],
      error: null,
    }));
    expect(await resolveFolderRollup(client, "f1")).toEqual({
      ok: false,
      error: FOLDER_DATA_ERROR,
    });
  });
});

describe("resolveFolderBurn", () => {
  it("calls folder_burn and camel-cases the row", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          stage_key: "build",
          week_start: "2026-09-07",
          planned: 4,
          completed: 2,
        },
      ],
      error: null,
    }));
    const res = await resolveFolderBurn(client, "f1");
    expect(client.rpc).toHaveBeenCalledWith("folder_burn", {
      p_folder_id: "f1",
    });
    expect(res).toEqual({
      ok: true,
      rows: [
        {
          stageKey: "build",
          weekStart: "2026-09-07",
          planned: 4,
          completed: 2,
        },
      ],
    });
  });

  it("rejects a row with a missing/renamed column", async () => {
    const client = clientWith(async () => ({
      data: [{ stage_key: "build", week_start: "2026-09-07", planned: 4 }],
      error: null,
    }));
    expect(await resolveFolderBurn(client, "f1")).toEqual({
      ok: false,
      error: FOLDER_DATA_ERROR,
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

  it("rejects the batch when a row's reason isn't one of the four (replaces the old silent drop)", async () => {
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
    expect(res).toEqual({ ok: false, error: FOLDER_DATA_ERROR });
  });
});

describe("resolveFolderWorkload", () => {
  it("maps a row with user_id: null (the Unassigned row) straight through", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          user_id: null,
          board_id: "b1",
          board_name: "Backend",
          stage_key: "build",
          stage_name: "Build",
          open_items: 3,
          overdue_items: 1,
        },
        {
          user_id: "u1",
          board_id: "b1",
          board_name: "Backend",
          stage_key: "build",
          stage_name: "Build",
          open_items: 2,
          overdue_items: 0,
        },
      ],
      error: null,
    }));
    const res = await resolveFolderWorkload(client, "f1");
    expect(res).toEqual({
      ok: true,
      rows: [
        {
          userId: null,
          boardId: "b1",
          boardName: "Backend",
          stageKey: "build",
          stageName: "Build",
          open: 3,
          overdue: 1,
        },
        {
          userId: "u1",
          boardId: "b1",
          boardName: "Backend",
          stageKey: "build",
          stageName: "Build",
          open: 2,
          overdue: 0,
        },
      ],
    });
  });

  it("rejects a row with a swapped/missing column", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          user_id: "u1",
          board_id: "b1",
          board_name: "Backend",
          // stage_key renamed/missing
          stage_name: "Build",
          open_items: 2,
          overdue_items: 0,
        },
      ],
      error: null,
    }));
    expect(await resolveFolderWorkload(client, "f1")).toEqual({
      ok: false,
      error: FOLDER_DATA_ERROR,
    });
  });
});

describe("resolveFolderGallery", () => {
  it("calls folder_gallery and camel-cases the row", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          folder_id: "f1",
          folder_name: "Q4",
          folder_position: 0,
          board_count: 3,
          item_count: 20,
          done_count: 10,
          overdue_count: 2,
          attention_count: 4,
        },
      ],
      error: null,
    }));
    const res = await resolveFolderGallery(client, "w1");
    expect(client.rpc).toHaveBeenCalledWith("folder_gallery", {
      p_workspace_id: "w1",
    });
    expect(res).toEqual({
      ok: true,
      rows: [
        {
          folderId: "f1",
          name: "Q4",
          position: 0,
          boards: 3,
          items: 20,
          done: 10,
          overdue: 2,
          attention: 4,
        },
      ],
    });
  });

  it("maps a P0002 (workspace not found / not a member) error to FOLDER_GONE_ERROR", async () => {
    const client = clientWith(async () => ({
      data: null,
      error: { code: "P0002", message: "workspace not found" },
    }));
    expect(await resolveFolderGallery(client, "w1")).toEqual({
      ok: false,
      error: FOLDER_GONE_ERROR,
    });
  });
});
