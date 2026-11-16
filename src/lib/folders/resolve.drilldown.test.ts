import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  POSTGREST_MAX_ROWS,
  resolveFolderAttention,
  resolveFolderGallery,
  resolveFolderKpiItems,
  resolveFolderRollup,
  resolveFolderWorkload,
} from "./resolve";
import { FOLDER_DATA_ERROR, KPI_ITEMS_UNAVAILABLE } from "./types";

// The reads added with supabase/migrations/20261116112338_folder_drilldown.sql,
// against a database that HAS the new functions and one that does not yet.

const MISSING = {
  data: null,
  error: { code: "PGRST202", message: "function not found" },
};
function clientWith(
  rpc: (fn: string, args: Record<string, unknown>) => unknown,
) {
  return { rpc: vi.fn(rpc) } as unknown as SupabaseClient<Database>;
}

const rollupRow = (i: number) => ({
  board_id: `b${i}`,
  board_name: `Board ${i}`,
  board_position: i,
  group_id: `g${i}`,
  group_name: "Build",
  group_color: null,
  group_position: 0,
  total: 1,
  done: 0,
  in_progress: 1,
  overdue: 0,
  not_started: 0,
  blocked: 0,
  stale: 0,
  unassigned: 0,
  incomplete: 0,
  planned_by_today: 0,
  due_this_week: 0,
  due_this_week_not_started: 0,
  oldest_overdue: null,
  min_due: null,
  max_due: null,
  done_dated: 0,
});
const workloadRow = (i: number) => ({
  user_id: `u${i}`,
  board_id: "b1",
  board_name: "Backend",
  stage_key: "build",
  stage_name: "Build",
  open_items: 1,
  overdue_items: 0,
});
const attentionRow = (
  i: number,
  board = "b1",
  group: string | null = "Build",
) => ({
  item_id: `i${i}`,
  item_name: `Item ${i}`,
  board_id: board,
  board_name: board,
  group_id: group === null ? null : "g",
  group_name: group,
  reason: "overdue",
  age_days: 200 - i,
  severity: 4,
});

describe("rollup and workload: no silent 1,000-row cap", () => {
  it("reads folder_rollup_packed in ONE call and never the capped function", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => rollupRow(i));
    const client = clientWith(async () => ({
      data: { total: 1500, rows },
      error: null,
    }));
    const res = await resolveFolderRollup(client, "f1");
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("folder_rollup_packed", {
      p_folder_id: "f1",
    });
    // 1,500 rows arrive: more than PostgREST would ever return as a set.
    expect(res.ok && res.rows.length).toBe(1500);
    expect(res.ok && res.capped).toBeUndefined();
  });

  it("says so when the packed function itself stopped at its bound", async () => {
    const client = clientWith(async () => ({
      data: { total: 7000, rows: [rollupRow(1)] },
      error: null,
    }));
    const res = await resolveFolderRollup(client, "f1");
    expect(res).toMatchObject({ ok: true, capped: true });
  });

  it("falls back to folder_rollup when the packed function is absent, and flags a full 1,000 rows", async () => {
    const full = Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) =>
      rollupRow(i),
    );
    const client = clientWith(async (fn) =>
      fn === "folder_rollup_packed" ? MISSING : { data: full, error: null },
    );
    const res = await resolveFolderRollup(client, "f1");
    expect(client.rpc).toHaveBeenLastCalledWith("folder_rollup", {
      p_folder_id: "f1",
    });
    expect(res).toMatchObject({ ok: true, capped: true });
    // 999 rows is not a cap.
    const under = clientWith(async (fn) =>
      fn === "folder_rollup_packed"
        ? MISSING
        : { data: full.slice(1), error: null },
    );
    const ok = await resolveFolderRollup(under, "f1");
    expect(ok.ok && ok.capped).toBeUndefined();
  });

  it("fails closed on a packed value of the wrong shape or a real error", async () => {
    const wrong = clientWith(async () => ({
      data: [rollupRow(1)],
      error: null,
    }));
    expect(await resolveFolderRollup(wrong, "f1")).toEqual({
      ok: false,
      error: FOLDER_DATA_ERROR,
    });
    const boom = clientWith(async () => ({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    }));
    expect(await resolveFolderRollup(boom, "f1")).toEqual({
      ok: false,
      error: FOLDER_DATA_ERROR,
    });
    // A real error is NOT treated as "function absent": no second call.
    expect(boom.rpc).toHaveBeenCalledTimes(1);
  });

  it("workload: packed first, the old function as fallback with the cap flagged", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => workloadRow(i));
    const packed = clientWith(async () => ({
      data: { total: 1200, rows },
      error: null,
    }));
    const a = await resolveFolderWorkload(packed, "f1");
    expect(packed.rpc).toHaveBeenCalledWith("folder_workload_packed", {
      p_folder_id: "f1",
    });
    expect(a.ok && a.rows.length).toBe(1200);
    expect(a.ok && a.capped).toBeUndefined();

    const old = clientWith(async (fn) =>
      fn === "folder_workload_packed"
        ? MISSING
        : { data: rows.slice(0, POSTGREST_MAX_ROWS), error: null },
    );
    expect(await resolveFolderWorkload(old, "f1")).toMatchObject({
      ok: true,
      capped: true,
    });
  });

  it("gallery: a full 1,000 folders is reported as capped", async () => {
    const row = (i: number) => ({
      folder_id: `f${i}`,
      folder_name: `F${i}`,
      folder_position: i,
      board_count: 0,
      item_count: 0,
      done_count: 0,
      overdue_count: 0,
      attention_count: 0,
    });
    const full = clientWith(async () => ({
      data: Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) => row(i)),
      error: null,
    }));
    expect(await resolveFolderGallery(full, "w1")).toMatchObject({
      ok: true,
      capped: true,
    });
    const few = clientWith(async () => ({ data: [row(1)], error: null }));
    const res = await resolveFolderGallery(few, "w1");
    expect(res.ok && res.capped).toBeUndefined();
  });
});

describe("resolveFolderAttention: the filter is in the query", () => {
  it("sends board, stage, limit and offset to folder_attention_page and returns its total", async () => {
    const client = clientWith(async () => ({
      data: { total: 240, rows: [attentionRow(1)] },
      error: null,
    }));
    const res = await resolveFolderAttention(client, "f1", 20, {
      boardId: "b1",
      stageKey: "build",
      offset: 40,
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("folder_attention_page", {
      p_folder_id: "f1",
      p_board_id: "b1",
      p_stage_key: "build",
      p_reason: null,
      p_limit: 20,
      p_offset: 40,
    });
    expect(res).toMatchObject({ ok: true, total: 240 });
    expect(res.ok && res.rows[0]).toMatchObject({
      itemId: "i1",
      reason: "overdue",
    });
  });

  it("without the new function: filters the old top 100 here and reports the total as UNKNOWN when that read was cut", async () => {
    // 100 rows (the old limit): 95 on board a, 5 on board b. Board b has
    // more beyond the cut that this path cannot see.
    const top = [
      ...Array.from({ length: 95 }, (_, i) => attentionRow(i, "a")),
      ...Array.from({ length: 5 }, (_, i) => attentionRow(100 + i, "b")),
    ];
    const client = clientWith(async (fn) =>
      fn === "folder_attention_page" ? MISSING : { data: top, error: null },
    );
    const res = await resolveFolderAttention(client, "f1", 20, {
      boardId: "b",
    });
    // With a filter the old function is asked for all it will give.
    expect(client.rpc).toHaveBeenLastCalledWith("folder_attention", {
      p_folder_id: "f1",
      p_limit: 100,
    });
    expect(res.ok && res.rows.map((r) => r.boardId)).toEqual([
      "b",
      "b",
      "b",
      "b",
      "b",
    ]);
    expect(res.ok && res.total).toBeNull();
  });

  it("without the new function: the count is exact when the old read was not cut, and stage / offset apply", async () => {
    const rows = [
      attentionRow(1, "a", " Build "),
      attentionRow(2, "a", "Design"),
      attentionRow(3, "a", "build"),
      attentionRow(4, "a", null),
    ];
    const client = clientWith(async (fn) =>
      fn === "folder_attention_page" ? MISSING : { data: rows, error: null },
    );
    const res = await resolveFolderAttention(client, "f1", 1, {
      stageKey: "build",
      offset: 1,
    });
    expect(res).toMatchObject({ ok: true, total: 2 });
    expect(res.ok && res.rows.map((r) => r.itemId)).toEqual(["i3"]);
  });

  it("fails closed on a malformed page", async () => {
    const client = clientWith(async () => ({
      data: { total: 1, rows: [{ ...attentionRow(1), reason: "mystery" }] },
      error: null,
    }));
    expect(await resolveFolderAttention(client, "f1")).toEqual({
      ok: false,
      error: FOLDER_DATA_ERROR,
    });
  });
});

describe("resolveFolderKpiItems", () => {
  const item = {
    item_id: "i1",
    item_name: "Ship it",
    board_id: "b1",
    board_name: "Backend",
    group_id: "g1",
    group_name: "Build",
    due_on: "2026-09-01",
    done_on: null,
    last_touched: "2026-09-02T10:00:00+00:00",
    is_done: false,
    is_overdue: true,
  };

  it("asks for one bounded page in the card's scope and returns the total", async () => {
    const client = clientWith(async () => ({
      data: { total: 402, rows: [item] },
      error: null,
    }));
    const res = await resolveFolderKpiItems(client, "f1", {
      kpi: "overdue",
      boardId: "b1",
      stageKey: "build",
      limit: 50,
      offset: 100,
    });
    expect(client.rpc).toHaveBeenCalledWith("folder_kpi_items", {
      p_folder_id: "f1",
      p_kpi: "overdue",
      p_board_id: "b1",
      p_stage_key: "build",
      p_limit: 50,
      p_offset: 100,
    });
    expect(res).toEqual({
      ok: true,
      total: 402,
      rows: [
        {
          itemId: "i1",
          itemName: "Ship it",
          boardId: "b1",
          boardName: "Backend",
          groupId: "g1",
          groupName: "Build",
          dueOn: "2026-09-01",
          doneOn: null,
          lastTouched: "2026-09-02T10:00:00+00:00",
          isDone: false,
          isOverdue: true,
        },
      ],
    });
  });

  it("defaults to the whole folder, 50 items, from the top", async () => {
    const client = clientWith(async () => ({
      data: { total: 0, rows: [] },
      error: null,
    }));
    await resolveFolderKpiItems(client, "f1", { kpi: "done" });
    expect(client.rpc).toHaveBeenCalledWith("folder_kpi_items", {
      p_folder_id: "f1",
      p_kpi: "done",
      p_board_id: null,
      p_stage_key: null,
      p_limit: 50,
      p_offset: 0,
    });
  });

  it("answers 'not available yet' on a database without the function, never a crash", async () => {
    const client = clientWith(async () => MISSING);
    expect(
      await resolveFolderKpiItems(client, "f1", { kpi: "overdue" }),
    ).toEqual({ ok: false, error: KPI_ITEMS_UNAVAILABLE });
  });

  it("fails closed on a malformed row", async () => {
    const client = clientWith(async () => ({
      data: { total: 1, rows: [{ ...item, is_done: "no" }] },
      error: null,
    }));
    expect(
      await resolveFolderKpiItems(client, "f1", { kpi: "overdue" }),
    ).toEqual({ ok: false, error: FOLDER_DATA_ERROR });
  });
});
