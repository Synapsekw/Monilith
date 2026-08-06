import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail, type ActionResult } from "@/lib/actions/result";
import {
  getWidgetAggregationCached,
  getWidgetCompletionCached,
  getWidgetHealthCached,
} from "@/lib/dashboards/queries-cached";
import { resolveSeries, resolveRows } from "@/lib/dashboards/widget-resolve";
import type {
  WidgetAggregatePayload,
  WidgetDataResult,
} from "@/lib/dashboards/actions";
import type { Database, Json, Tables } from "@/types/database.types";

type Widget = Tables<"dashboard_widgets">;

/** The columns a widget row must carry to resolve its aggregation. Shared by the
 *  single (`.eq`) and batched (`.in`) reads so both trust the DB row, never the
 *  client — RLS scopes which rows are visible. */
export type WidgetAggRow = {
  kind: Widget["kind"];
  config: Json | null;
  source_board_id: string | null;
  org_id: string;
};

/**
 * Resolve one widget row's aggregate. The widget's `org_id` + `source_board_id`
 * come from the server-read row (never the client), so `orgId` is part of the
 * cached fn's key + tag — cross-tenant isolation holds by construction. The
 * cached fn also resolves the group column's options server-side (so
 * renames/recolors reflect without a stale client snapshot), bounded by the
 * short `widget` TTL.
 */
export async function resolveWidgetAggregate(
  widgetId: string,
  widget: WidgetAggRow,
): Promise<ActionResult<WidgetAggregatePayload>> {
  if (!widget.source_board_id)
    return {
      ok: true,
      data: { kind: widget.kind, config: {}, buckets: [], columnMeta: null },
    };

  const config = (widget.config ?? {}) as Record<string, unknown>;

  if (widget.kind === "completion") {
    const result = await getWidgetCompletionCached({
      widgetId,
      orgId: widget.org_id,
      boardId: widget.source_board_id,
      config,
    });
    if (!result.ok) return fail(result.error);
    return {
      ok: true,
      data: {
        kind: widget.kind,
        config,
        buckets: [],
        columnMeta: null,
        completion: { rows: result.rows, groups: result.groups },
      },
    };
  }

  if (widget.kind === "health") {
    const result = await getWidgetHealthCached({
      widgetId,
      orgId: widget.org_id,
      boardId: widget.source_board_id,
      config,
    });
    if (!result.ok) return fail(result.error);
    return {
      ok: true,
      data: {
        kind: widget.kind,
        config,
        buckets: [],
        columnMeta: null,
        health: result.counts,
      },
    };
  }

  const result = await getWidgetAggregationCached({
    widgetId,
    orgId: widget.org_id,
    boardId: widget.source_board_id,
    config,
    groupColumnId: (config.groupColumnId as string | undefined) ?? null,
  });
  if (!result.ok) return fail(result.error);

  return {
    ok: true,
    data: {
      kind: widget.kind,
      config,
      buckets: result.buckets,
      columnMeta: result.columnMeta,
    },
  };
}

/**
 * Resolve one widget row to its batched slot, dispatching on kind: chart →
 * series, list → rows (both uncached, over the request's RLS client, exactly as
 * the standalone getWidgetSeries/getWidgetRows did), everything else → the cached
 * aggregate. This is what lets chart + list widgets ride the same batched fetch
 * as the aggregate family instead of firing a per-widget action each.
 *
 * Lives here rather than in actions.ts because that module is `"use server"`,
 * where every export becomes a public server-action endpoint. The signature is
 * unchanged — it already took the client as a parameter, which is what makes
 * the MCP path a straight reuse.
 */
export async function resolveWidgetSlot(
  supabase: SupabaseClient<Database>,
  widgetId: string,
  widget: WidgetAggRow,
): Promise<WidgetDataResult> {
  if (widget.kind === "chart") {
    const r = await resolveSeries(supabase, {
      boardId: widget.source_board_id ?? "",
      orgId: widget.org_id,
      config: (widget.config ?? {}) as Record<string, unknown>,
    });
    return r.ok
      ? { ok: true, shape: "series", series: r.data }
      : { ok: false, error: r.error };
  }
  if (widget.kind === "list") {
    if (!widget.source_board_id)
      return { ok: true, shape: "rows", rows: { columns: [], rows: [] } };
    const r = await resolveRows(supabase, {
      boardId: widget.source_board_id,
      config: (widget.config ?? {}) as Record<string, unknown>,
    });
    return r.ok
      ? { ok: true, shape: "rows", rows: r.data }
      : { ok: false, error: r.error };
  }
  const res = await resolveWidgetAggregate(widgetId, widget);
  return res.ok ? { ok: true, ...res.data } : { ok: false, error: res.error };
}
