import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { dashboardsTag, widgetAggregationTag } from "@/lib/cache/tags";
import { optionSchema } from "@/lib/validations/boards";
import type { Dashboard } from "@/lib/dashboards/queries";
import type {
  AggregateBucket,
  ColumnMeta,
  CompletionGroupRow,
  GroupMeta,
  HealthCounts,
} from "@/lib/dashboards/widget-data";
import type { Json } from "@/types/database.types";

/** Hot-path cap (AGENTS.md: bounded reads over dashboards_org_id_idx).
 * Truncates silently at the cap. */
export const DASHBOARDS_LIMIT = 100;

/**
 * Cached org dashboards list. `orgId` is passed in (part of the cache key + tag);
 * the explicit `org_id = orgId` filter is the tenant boundary (the service client
 * bypasses RLS).
 */
export async function listDashboardsCached(
  orgId: string,
): Promise<Dashboard[]> {
  "use cache";
  cacheLife("nav");
  cacheTag(dashboardsTag(orgId));

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("dashboards")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .limit(DASHBOARDS_LIMIT);
  return data ?? [];
}

export type WidgetAggregation =
  | { ok: true; buckets: AggregateBucket[]; columnMeta: ColumnMeta | null }
  | { ok: false; error: string };

/**
 * Cached widget aggregation read (Phase 9.3b). The caller (`getWidgetData`)
 * resolves the widget's `orgId` + `boardId` from `dashboard_widgets` first and
 * passes them in: `orgId` is part of the cache key AND the tag, so a second org
 * can never serve or invalidate org A's entry. The service client bypasses RLS —
 * the resolved board/org pair is the tenant boundary, matching
 * `listDashboardsCached`.
 *
 * Freshness tradeoff: board cell-data feeding the aggregation changes from too
 * many sources to tag reliably, so it's bounded by `cacheLife("widget")` (~30s).
 * Widget *config* edits stay instant via `updateTag` on the per-widget tag.
 */
export async function getWidgetAggregationCached(input: {
  widgetId: string;
  orgId: string;
  boardId: string;
  config: Record<string, unknown>;
  groupColumnId: string | null;
}): Promise<WidgetAggregation> {
  "use cache";
  cacheLife("widget");
  cacheTag(widgetAggregationTag(input.orgId, input.widgetId));

  const supabase = createServiceClient();
  const agg = (input.config.agg as string) ?? "count";
  const { data, error } = await supabase.rpc("dashboard_aggregate", {
    p_board_id: input.boardId,
    p_group_column_id: (input.config.groupColumnId as string) ?? undefined,
    p_value_column_id: (input.config.valueColumnId as string) ?? undefined,
    p_agg: agg,
  });
  if (error) return { ok: false, error: error.message };

  const buckets: AggregateBucket[] = (data ?? []).map((r) => ({
    group_key: r.group_key,
    metric: Number(r.metric),
  }));

  let columnMeta: ColumnMeta | null = null;
  if (input.groupColumnId) {
    const { data: col } = await supabase
      .from("columns")
      .select("kind, settings")
      .eq("id", input.groupColumnId)
      .maybeSingle();
    if (col) {
      const opts = optionSchema
        .array()
        .safeParse((col.settings as { options?: unknown }).options ?? []);
      columnMeta = { kind: col.kind, options: opts.success ? opts.data : [] };
    }
  }

  return { ok: true, buckets, columnMeta };
}

export type WidgetCompletion =
  | { ok: true; rows: CompletionGroupRow[]; groups: GroupMeta[] }
  | { ok: false; error: string };

/**
 * Cached completion read for the Completion widget — the 9.3b contract verbatim:
 * the caller resolves orgId/boardId from the widget row (tenant boundary), the
 * entry is keyed by org+widget+config and tagged widgetAggregationTag so the
 * existing create/update/delete updateTag calls invalidate it with zero new
 * code. Board-data freshness is TTL-bounded (cacheLife "widget", ~30s), the
 * same tradeoff as getWidgetAggregationCached. Group meta (name/color,
 * position order) is resolved here so renames/recolors surface within the TTL.
 */
export async function getWidgetCompletionCached(input: {
  widgetId: string;
  orgId: string;
  boardId: string;
  config: Record<string, unknown>;
}): Promise<WidgetCompletion> {
  "use cache";
  cacheLife("widget");
  cacheTag(widgetAggregationTag(input.orgId, input.widgetId));

  const mode = (input.config.mode as string) ?? "status";
  const valueColumnId =
    mode === "percent"
      ? ((input.config.percentColumnId as string | undefined) ?? null)
      : ((input.config.statusColumnId as string | undefined) ?? null);
  // Unconfigured widget → empty result (widget renders its configure state).
  if (!valueColumnId) return { ok: true, rows: [], groups: [] };

  const supabase = createServiceClient();
  const [rpc, groupsRes] = await Promise.all([
    supabase.rpc("dashboard_completion", {
      p_board_id: input.boardId,
      p_mode: mode,
      p_value_column_id: valueColumnId,
      p_done_option_ids: ((input.config.doneOptionIds as string[]) ??
        []) as Json,
    }),
    supabase
      .from("groups")
      .select("id, name, color")
      .eq("board_id", input.boardId)
      .order("position", { ascending: true })
      .limit(100), // bounded: groups are user-managed row bands (groups_board_id_idx)
  ]);
  if (rpc.error) return { ok: false, error: rpc.error.message };

  return {
    ok: true,
    rows: (rpc.data ?? []).map((r) => ({
      groupKey: r.group_key,
      itemCount: Number(r.item_count),
      completion: Number(r.completion),
    })),
    groups: (groupsRes.data ?? []).map((g) => ({
      id: g.id,
      label: g.name,
      color: g.color,
    })),
  };
}

export type WidgetHealth =
  | { ok: true; counts: HealthCounts }
  | { ok: false; error: string };

/**
 * Cached health read — the 9.3b contract verbatim: caller resolves orgId/boardId
 * from the widget row (tenant boundary), entry keyed by org+widget+config and
 * tagged widgetAggregationTag so existing create/update/delete updateTag calls
 * invalidate it with zero new code. Freshness is TTL-bounded (cacheLife
 * "widget", ~30s), same tradeoff as getWidgetAggregationCached.
 */
export async function getWidgetHealthCached(input: {
  widgetId: string;
  orgId: string;
  boardId: string;
  config: Record<string, unknown>;
}): Promise<WidgetHealth> {
  "use cache";
  cacheLife("widget");
  cacheTag(widgetAggregationTag(input.orgId, input.widgetId));

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("dashboard_health_summary", {
    p_board_id: input.boardId,
  });
  if (error) return { ok: false, error: error.message };
  const row = data?.[0];
  return {
    ok: true,
    counts: {
      totalItems: Number(row?.total_items ?? 0),
      doneItems: Number(row?.done_items ?? 0),
      overdueItems: Number(row?.overdue_items ?? 0),
      incompleteItems: Number(row?.incomplete_items ?? 0),
      newItems7d: Number(row?.new_items ?? 0),
    },
  };
}
