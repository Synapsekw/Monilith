import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { dashboardsTag, widgetAggregationTag } from "@/lib/cache/tags";
import { optionSchema } from "@/lib/validations/boards";
import type { Dashboard } from "@/lib/dashboards/queries";
import type { AggregateBucket, ColumnMeta } from "@/lib/dashboards/widget-data";

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
