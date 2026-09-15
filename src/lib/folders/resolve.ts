import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { Database } from "@/types/database.types";
import type {
  AttentionRow,
  BurnRow,
  GalleryRow,
  RollupRow,
  WorkloadRow,
} from "./types";
import { FOLDER_DATA_ERROR, FOLDER_GONE_ERROR } from "./types";

type DB = SupabaseClient<Database>;
export type Resolved<T> =
  { ok: true; rows: T[] } | { ok: false; error: string };

/**
 * Row shapes, snake_case, matching each RPC's `returns table` list EXACTLY
 * (see the migrations named in the header comments below) — not the
 * generated `Database["public"]["Functions"]` types, which lie about
 * nullability (every arg/return column is generated non-null regardless of
 * the actual SQL). Parsing through these means a renamed or dropped column
 * fails loudly here instead of silently producing `undefined` in the UI.
 */
const rollupRowSchema = z.object({
  board_id: z.string(),
  board_name: z.string(),
  board_position: z.number(),
  group_id: z.string().nullable(),
  group_name: z.string().nullable(),
  group_color: z.string().nullable(),
  group_position: z.number().nullable(),
  total: z.number(),
  done: z.number(),
  in_progress: z.number(),
  overdue: z.number(),
  not_started: z.number(),
  blocked: z.number(),
  stale: z.number(),
  unassigned: z.number(),
  incomplete: z.number(),
  planned_by_today: z.number(),
  due_this_week: z.number(),
  due_this_week_not_started: z.number(),
  oldest_overdue: z.string().nullable(),
  min_due: z.string().nullable(),
  max_due: z.string().nullable(),
});

const burnRowSchema = z.object({
  stage_key: z.string(),
  week_start: z.string(),
  planned: z.number(),
  completed: z.number(),
});

/** Replaces the old hand-rolled reason guard — an unrecognized `reason`
 * value now fails the whole batch (see `mapZodError`) instead of the row
 * being silently dropped. */
const attentionReasonSchema = z.enum([
  "overdue",
  "blocked",
  "unassigned",
  "stale",
]);
const attentionRowSchema = z.object({
  item_id: z.string(),
  item_name: z.string(),
  board_id: z.string(),
  board_name: z.string(),
  group_id: z.string().nullable(),
  group_name: z.string().nullable(),
  reason: attentionReasonSchema,
  age_days: z.number(),
  severity: z.number(),
});

/** `user_id` is genuinely NULL for the unassigned row even though the
 * generated RPC return type narrows it to `string` (ruling 2). */
const workloadRowSchema = z.object({
  user_id: z.string().nullable(),
  board_id: z.string(),
  board_name: z.string(),
  stage_key: z.string(),
  stage_name: z.string(),
  open_items: z.number(),
  overdue_items: z.number(),
});

const galleryRowSchema = z.object({
  folder_id: z.string(),
  folder_name: z.string(),
  folder_position: z.number(),
  board_count: z.number(),
  item_count: z.number(),
  done_count: z.number(),
  overdue_count: z.number(),
  attention_count: z.number(),
});

type RpcError = { code?: string | null; message: string };

/**
 * Every RPC's guard (`_assert_folder_member`, or `folder_gallery`'s own
 * workspace check) raises a single P0002 for both "doesn't exist" and "not a
 * member of its org" (ruling 1 / the folder_burn_workload_gallery migration's
 * ruling 1) — map that straight to FOLDER_GONE_ERROR. Anything else is an
 * unexpected failure: log it once server-side and hand the UI a generic
 * message rather than forwarding raw Postgres text.
 */
function mapRpcError(error: RpcError, rpc: string): string {
  if (error.code === "P0002") return FOLDER_GONE_ERROR;
  console.error(`[folders] ${rpc} RPC failed: ${error.message}`);
  return FOLDER_DATA_ERROR;
}

/** A row that fails Zod validation is a schema-drift bug, not a data problem
 * a user can retry past — log once with the failing path and fail closed. */
function mapZodError(error: z.ZodError, rpc: string): string {
  const issue = error.issues[0];
  console.error(
    `[folders] ${rpc} row failed validation at "${issue?.path.join(".")}": ${issue?.message}`,
  );
  return FOLDER_DATA_ERROR;
}

/**
 * Every RPC here is security definer and gates on auth.uid() (is_org_member +
 * readable_board_ids), so `supabase` MUST be the request's RLS client — never
 * the service client (see src/lib/dashboards/queries-cached.ts:35-55).
 */
export async function resolveFolderRollup(
  supabase: DB,
  folderId: string,
): Promise<Resolved<RollupRow>> {
  const { data, error } = await typedRpc(supabase, "folder_rollup", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: mapRpcError(error, "folder_rollup") };
  const parsed = z.array(rollupRowSchema).safeParse(data ?? []);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_rollup") };
  return {
    ok: true,
    rows: parsed.data.map((r) => ({
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
  if (error) return { ok: false, error: mapRpcError(error, "folder_burn") };
  const parsed = z.array(burnRowSchema).safeParse(data ?? []);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_burn") };
  return {
    ok: true,
    rows: parsed.data.map((r) => ({
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
  if (error)
    return { ok: false, error: mapRpcError(error, "folder_attention") };
  const parsed = z.array(attentionRowSchema).safeParse(data ?? []);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_attention") };
  return {
    ok: true,
    rows: parsed.data.map((r) => ({
      itemId: r.item_id,
      itemName: r.item_name,
      boardId: r.board_id,
      boardName: r.board_name,
      groupId: r.group_id,
      groupName: r.group_name,
      reason: r.reason,
      ageDays: r.age_days,
      severity: r.severity,
    })),
  };
}

export async function resolveFolderWorkload(
  supabase: DB,
  folderId: string,
): Promise<Resolved<WorkloadRow>> {
  const { data, error } = await typedRpc(supabase, "folder_workload", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: mapRpcError(error, "folder_workload") };
  const parsed = z.array(workloadRowSchema).safeParse(data ?? []);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_workload") };
  return {
    ok: true,
    rows: parsed.data.map((r) => ({
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
  if (error) return { ok: false, error: mapRpcError(error, "folder_gallery") };
  const parsed = z.array(galleryRowSchema).safeParse(data ?? []);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_gallery") };
  return {
    ok: true,
    rows: parsed.data.map((r) => ({
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
