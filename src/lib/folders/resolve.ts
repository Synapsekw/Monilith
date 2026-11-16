import "server-only";
import * as z from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { Database } from "@/types/database.types";
import {
  folderTimelineSchema,
  type FolderTimelineData,
} from "@/lib/boards/timeline-context";
import type {
  AttentionPage,
  AttentionRow,
  BurnPacked,
  GalleryRow,
  KpiItemKind,
  KpiItemsPage,
  LoadRow,
  RollupRow,
  WorkloadRow,
} from "./types";
import {
  FOLDER_DATA_ERROR,
  FOLDER_GONE_ERROR,
  KPI_ITEMS_UNAVAILABLE,
} from "./types";
import { parseBurnPacked, unpackLoadPacked } from "./packed";
import { isMissingFunction, newFolderRpc } from "./rpc-shim";
import { stageKey } from "./stages";

type DB = SupabaseClient<Database>;
/** `capped: true` means a row cap cut the read: the rows are incomplete. */
export type Resolved<T> =
  { ok: true; rows: T[]; capped?: boolean } | { ok: false; error: string };

/**
 * PostgREST's `max_rows` (supabase/config.toml). A set-returning RPC that
 * comes back with this many rows was almost certainly cut, silently.
 */
export const POSTGREST_MAX_ROWS = 1000;

/** `folder_attention`'s own hard ceiling (`least(greatest(p_limit, 1), 100)`). */
const ATTENTION_MAX = 100;

/** `{ total, rows }`: the value the *_packed and *_page functions return. */
const packedRowsSchema = z.object({
  total: z.number(),
  rows: z.array(z.unknown()),
});

type PackedRead =
  | { kind: "missing" }
  | { kind: "error"; error: string }
  | { kind: "ok"; total: number; rows: unknown[] };

/**
 * One execution of a `*_packed` function: a single jsonb value, which
 * PostgREST's row cap cannot cut. `missing` = the database has not had
 * 20261116112338_folder_drilldown yet; the caller falls back to the
 * set-returning function.
 */
async function readPacked(
  supabase: DB,
  fn: "folder_rollup_packed" | "folder_workload_packed",
  folderId: string,
): Promise<PackedRead> {
  const { data, error } = await newFolderRpc(supabase, fn, {
    p_folder_id: folderId,
  });
  if (error) {
    if (isMissingFunction(error)) return { kind: "missing" };
    return { kind: "error", error: mapRpcError(error, fn) };
  }
  const parsed = packedRowsSchema.safeParse(data);
  if (!parsed.success)
    return { kind: "error", error: mapZodError(parsed.error, fn) };
  return { kind: "ok", total: parsed.data.total, rows: parsed.data.rows };
}

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
  // Added by 20261115173751_one_overdue_rule. Optional so a database that has
  // not had that migration yet still parses; the mapper then falls back to
  // `done` (the old, mixed-population gap).
  done_dated: z.number().optional(),
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
  // One row per board and group, so a large folder can pass PostgREST's
  // 1,000-row cap. The packed function cannot be cut by it; the old one is
  // the fallback for a database without the packed function, and a full
  // 1,000 rows from it is reported as capped.
  const packed = await readPacked(supabase, "folder_rollup_packed", folderId);
  if (packed.kind === "error") return { ok: false, error: packed.error };
  let raw: unknown;
  let capped: boolean;
  if (packed.kind === "ok") {
    raw = packed.rows;
    capped = packed.total > packed.rows.length;
  } else {
    const { data, error } = await typedRpc(supabase, "folder_rollup", {
      p_folder_id: folderId,
    });
    if (error) return { ok: false, error: mapRpcError(error, "folder_rollup") };
    raw = data ?? [];
    capped = (data ?? []).length >= POSTGREST_MAX_ROWS;
  }
  const parsed = z.array(rollupRowSchema).safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_rollup") };
  return {
    ok: true,
    ...(capped ? { capped: true } : {}),
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
      doneDated: r.done_dated ?? r.done,
    })),
  };
}

/**
 * The burn chart's series: ONE execution of `folder_burn_packed` (a single
 * jsonb value, so PostgREST's 1,000-row cap cannot truncate it and pages
 * cannot overlap), VALIDATED here but left packed: the page ships the
 * non-zero cells and the browser expands them (`burnRowsOf`). Any RPC error
 * or malformed value fails the whole read (the panel's Retry) — never a
 * partial chart.
 */
export async function resolveFolderBurn(
  supabase: DB,
  folderId: string,
): Promise<{ ok: true; packed: BurnPacked } | { ok: false; error: string }> {
  const { data, error } = await typedRpc(supabase, "folder_burn_packed", {
    p_folder_id: folderId,
  });
  if (error)
    return { ok: false, error: mapRpcError(error, "folder_burn_packed") };
  return parseBurnPacked(data);
}

/** The load heat map's rows: ONE `folder_load` execution (jsonb, bounded at
 *  5,000 rows by the function), unpacked and validated, with the server's
 *  week columns. */
export async function resolveFolderLoad(
  supabase: DB,
  folderId: string,
): Promise<
  { ok: true; weeks: string[]; rows: LoadRow[] } | { ok: false; error: string }
> {
  const { data, error } = await typedRpc(supabase, "folder_load", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: mapRpcError(error, "folder_load") };
  return unpackLoadPacked(data);
}

function toAttentionRow(r: z.infer<typeof attentionRowSchema>): AttentionRow {
  return {
    itemId: r.item_id,
    itemName: r.item_name,
    boardId: r.board_id,
    boardName: r.board_name,
    groupId: r.group_id,
    groupName: r.group_name,
    reason: r.reason,
    ageDays: r.age_days,
    severity: r.severity,
  };
}

export type AttentionFilter = {
  boardId?: string | null;
  stageKey?: string | null;
  offset?: number;
};

/**
 * One bounded page of the folder's attention rows, most urgent first, with
 * the count of ALL rows that match the board / stage filter.
 *
 * `folder_attention_page` applies the filter INSIDE the query, so the limit
 * applies to matching rows. A database without it (before
 * 20261116112338_folder_drilldown) is read through the old `folder_attention`,
 * which can only return the folder's top 100: the filter then runs here,
 * over those rows, and `total` is null whenever that read hit its limit (rows
 * past it may match and cannot be seen). Callers show that as "of the
 * folder's most urgent", never as a complete list.
 */
export async function resolveFolderAttention(
  supabase: DB,
  folderId: string,
  limit = 20,
  filter: AttentionFilter = {},
): Promise<({ ok: true } & AttentionPage) | { ok: false; error: string }> {
  const boardId = filter.boardId ?? null;
  const stage = filter.stageKey ?? null;
  const offset = filter.offset ?? 0;
  const page = await newFolderRpc(supabase, "folder_attention_page", {
    p_folder_id: folderId,
    p_board_id: boardId,
    p_stage_key: stage,
    p_reason: null,
    p_limit: limit,
    p_offset: offset,
  });
  if (page.error && !isMissingFunction(page.error))
    return {
      ok: false,
      error: mapRpcError(page.error, "folder_attention_page"),
    };
  if (!page.error) {
    const shape = packedRowsSchema.safeParse(page.data);
    if (!shape.success)
      return {
        ok: false,
        error: mapZodError(shape.error, "folder_attention_page"),
      };
    const parsed = z.array(attentionRowSchema).safeParse(shape.data.rows);
    if (!parsed.success)
      return {
        ok: false,
        error: mapZodError(parsed.error, "folder_attention_page"),
      };
    return {
      ok: true,
      rows: parsed.data.map(toAttentionRow),
      total: shape.data.total,
    };
  }
  // Fallback: the old function. With a filter or an offset it must be asked
  // for everything it will give, because it cannot filter.
  const filtered = boardId !== null || stage !== null || offset > 0;
  const asked = filtered ? ATTENTION_MAX : Math.min(limit, ATTENTION_MAX);
  const { data, error } = await typedRpc(supabase, "folder_attention", {
    p_folder_id: folderId,
    p_limit: asked,
  });
  if (error)
    return { ok: false, error: mapRpcError(error, "folder_attention") };
  const parsed = z.array(attentionRowSchema).safeParse(data ?? []);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_attention") };
  const matching = parsed.data
    .map(toAttentionRow)
    .filter(
      (a) =>
        (boardId === null || a.boardId === boardId) &&
        (stage === null ||
          (a.groupName !== null && stageKey(a.groupName) === stage)),
    );
  return {
    ok: true,
    rows: matching.slice(offset, offset + limit),
    // Fewer rows than asked for: the read was not cut, so the count is exact.
    total: parsed.data.length < asked ? matching.length : null,
  };
}

const kpiItemRowSchema = z.object({
  item_id: z.string(),
  item_name: z.string(),
  board_id: z.string(),
  board_name: z.string(),
  group_id: z.string().nullable(),
  group_name: z.string().nullable(),
  due_on: z.string().nullable(),
  done_on: z.string().nullable(),
  last_touched: z.string().nullable(),
  is_done: z.boolean(),
  is_overdue: z.boolean(),
});

/**
 * The items behind one KPI number: one bounded page (the function clamps the
 * limit to 100) plus the count of all matching items. There is no older
 * function to fall back to, so a database without `folder_kpi_items` answers
 * KPI_ITEMS_UNAVAILABLE.
 */
export async function resolveFolderKpiItems(
  supabase: DB,
  folderId: string,
  q: {
    kpi: KpiItemKind;
    boardId?: string | null;
    stageKey?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<({ ok: true } & KpiItemsPage) | { ok: false; error: string }> {
  const { data, error } = await newFolderRpc(supabase, "folder_kpi_items", {
    p_folder_id: folderId,
    p_kpi: q.kpi,
    p_board_id: q.boardId ?? null,
    p_stage_key: q.stageKey ?? null,
    p_limit: q.limit ?? 50,
    p_offset: q.offset ?? 0,
  });
  if (error) {
    if (isMissingFunction(error))
      return { ok: false, error: KPI_ITEMS_UNAVAILABLE };
    return { ok: false, error: mapRpcError(error, "folder_kpi_items") };
  }
  const shape = packedRowsSchema.safeParse(data);
  if (!shape.success)
    return { ok: false, error: mapZodError(shape.error, "folder_kpi_items") };
  const parsed = z.array(kpiItemRowSchema).safeParse(shape.data.rows);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_kpi_items") };
  return {
    ok: true,
    total: shape.data.total,
    rows: parsed.data.map((r) => ({
      itemId: r.item_id,
      itemName: r.item_name,
      boardId: r.board_id,
      boardName: r.board_name,
      groupId: r.group_id,
      groupName: r.group_name,
      dueOn: r.due_on,
      doneOn: r.done_on,
      lastTouched: r.last_touched,
      isDone: r.is_done,
      isOverdue: r.is_overdue,
    })),
  };
}

export async function resolveFolderWorkload(
  supabase: DB,
  folderId: string,
): Promise<Resolved<WorkloadRow>> {
  // One row per person, board and stage: see resolveFolderRollup for the cap.
  const packed = await readPacked(supabase, "folder_workload_packed", folderId);
  if (packed.kind === "error") return { ok: false, error: packed.error };
  let raw: unknown;
  let capped: boolean;
  if (packed.kind === "ok") {
    raw = packed.rows;
    capped = packed.total > packed.rows.length;
  } else {
    const { data, error } = await typedRpc(supabase, "folder_workload", {
      p_folder_id: folderId,
    });
    if (error)
      return { ok: false, error: mapRpcError(error, "folder_workload") };
    raw = data ?? [];
    capped = (data ?? []).length >= POSTGREST_MAX_ROWS;
  }
  const parsed = z.array(workloadRowSchema).safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_workload") };
  return {
    ok: true,
    ...(capped ? { capped: true } : {}),
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
    // One row per folder of the workspace: only a workspace with 1,000 or
    // more folders can reach the cap. The gallery says so when it does.
    ...(parsed.data.length >= POSTGREST_MAX_ROWS ? { capped: true } : {}),
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

/**
 * Folder Timeline tab data — every in-folder item's date cells, the folder's
 * boards (+ their date columns, timeline config and groups) and the links
 * between them. One jsonb payload, parsed whole: a shape drift fails the tab
 * loudly instead of drawing half a chart.
 */
export async function resolveFolderTimeline(
  supabase: DB,
  folderId: string,
): Promise<
  { ok: true; data: FolderTimelineData } | { ok: false; error: string }
> {
  const { data, error } = await typedRpc(supabase, "folder_timeline", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: mapRpcError(error, "folder_timeline") };
  const parsed = folderTimelineSchema.safeParse(data);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_timeline") };
  return { ok: true, data: parsed.data };
}
