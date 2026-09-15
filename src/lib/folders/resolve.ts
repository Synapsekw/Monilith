import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { Database } from "@/types/database.types";
import type {
  AttentionReason,
  AttentionRow,
  BurnRow,
  GalleryRow,
  RollupRow,
  WorkloadRow,
} from "./types";

type DB = SupabaseClient<Database>;
export type Resolved<T> =
  { ok: true; rows: T[] } | { ok: false; error: string };

const REASONS: readonly AttentionReason[] = [
  "overdue",
  "blocked",
  "unassigned",
  "stale",
];
function isReason(v: string): v is AttentionReason {
  return (REASONS as readonly string[]).includes(v);
}

/**
 * Every RPC here is security definer and gates on auth.uid() (is_org_member +
 * readable_board_ids), so `supabase` MUST be the request's RLS client — never
 * the service client (see src/lib/dashboards/queries-cached.ts:35-55).
 *
 * The guard (`_assert_folder_member`) raises a single P0002 for both a
 * nonexistent folder and a real folder in another org (no `42501` branch to
 * add) — its message ("folder not found") passes straight through as `error`.
 */
export async function resolveFolderRollup(
  supabase: DB,
  folderId: string,
): Promise<Resolved<RollupRow>> {
  const { data, error } = await typedRpc(supabase, "folder_rollup", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      boardId: r.board_id,
      boardName: r.board_name,
      boardPosition: r.board_position,
      groupId: r.group_id,
      groupName: r.group_name,
      groupColor: r.group_color,
      groupPosition: r.group_position,
      total: r.total,
      done: r.done,
      inProgress: r.in_progress,
      overdue: r.overdue,
      notStarted: r.not_started,
      blocked: r.blocked,
      stale: r.stale,
      unassigned: r.unassigned,
      incomplete: r.incomplete,
      plannedByToday: r.planned_by_today,
      dueThisWeek: r.due_this_week,
      dueThisWeekNotStarted: r.due_this_week_not_started,
      oldestOverdue: r.oldest_overdue,
      minDue: r.min_due,
      maxDue: r.max_due,
    })),
  };
}

export async function resolveFolderBurn(
  supabase: DB,
  folderId: string,
): Promise<Resolved<BurnRow>> {
  const { data, error } = await typedRpc(supabase, "folder_burn", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      stageKey: r.stage_key,
      weekStart: r.week_start,
      planned: r.planned,
      completed: r.completed,
    })),
  };
}

export async function resolveFolderAttention(
  supabase: DB,
  folderId: string,
  limit = 20,
): Promise<Resolved<AttentionRow>> {
  const { data, error } = await typedRpc(supabase, "folder_attention", {
    p_folder_id: folderId,
    p_limit: limit,
  });
  if (error) return { ok: false, error: error.message };
  const rows: AttentionRow[] = [];
  for (const r of data ?? []) {
    if (!isReason(r.reason)) continue;
    rows.push({
      itemId: r.item_id,
      itemName: r.item_name,
      boardId: r.board_id,
      boardName: r.board_name,
      groupId: r.group_id,
      groupName: r.group_name,
      reason: r.reason,
      ageDays: r.age_days,
      severity: r.severity,
    });
  }
  return { ok: true, rows };
}

/** `user_id` is genuinely NULL for the unassigned row even though the
 * generated RPC return type narrows it to `string` — WorkloadRow's `userId`
 * is `string | null` for exactly this row. */
export async function resolveFolderWorkload(
  supabase: DB,
  folderId: string,
): Promise<Resolved<WorkloadRow>> {
  const { data, error } = await typedRpc(supabase, "folder_workload", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      userId: r.user_id,
      boardId: r.board_id,
      boardName: r.board_name,
      stageKey: r.stage_key,
      stageName: r.stage_name,
      open: r.open_items,
      overdue: r.overdue_items,
    })),
  };
}

export async function resolveFolderGallery(
  supabase: DB,
  workspaceId: string,
): Promise<Resolved<GalleryRow>> {
  const { data, error } = await typedRpc(supabase, "folder_gallery", {
    p_workspace_id: workspaceId,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      folderId: r.folder_id,
      name: r.folder_name,
      position: r.folder_position,
      boards: r.board_count,
      items: r.item_count,
      done: r.done_count,
      overdue: r.overdue_count,
      attention: r.attention_count,
    })),
  };
}
