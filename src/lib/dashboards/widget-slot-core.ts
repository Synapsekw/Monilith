import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail, type ActionResult } from "@/lib/actions/result";
import {
  resolveAggregate,
  resolveCompletion,
  resolveHealth,
  resolveSeries,
  resolveRows,
} from "@/lib/dashboards/widget-resolve";
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
 * Resolve one widget row's aggregate over the caller's own RLS-respecting
 * client — exactly like resolveSeries/resolveRows below, and NOT the
 * `queries-cached.ts` service-client path this used to call.
 *
 * Why: `dashboard_aggregate`/`dashboard_completion`/`dashboard_health_summary`
 * are SECURITY DEFINER and gate on `is_org_member(v_org_id)` then
 * `can_read_board(p_board_id)` — both keyed off `auth.uid()`
 * (20260704110000_dashboard_rpc_board_read_guards.sql). The service client
 * (`createServiceClient()`) carries no user session, so `auth.uid()` is NULL
 * and `is_org_member` raises `42501` unconditionally — for every caller, every
 * time, regardless of whether they're actually authorized. No app-level
 * precheck can paper over that: the RPC itself always fails under the service
 * role. Routing the call through the request's own client is the only fix
 * that lets the RPC's own `auth.uid()`-based guard evaluate correctly.
 *
 * Tradeoff: this drops the `cacheLife("widget")` TTL cache these reads used
 * to ride (`queries-cached.ts`'s `getWidget{Aggregation,Completion,Health}Cached`,
 * now unused and removed) — a "use cache" scope cannot call `cookies()`
 * (Next 16 forbids dynamic APIs inside cache scope), so there is no way to
 * thread the per-request RLS client into a cached function, and caching the
 * service-client result is what caused this bug (it can never succeed). Chart
 * and list widgets already accepted this same tradeoff (uncached, RLS-client
 * RPCs); this brings number/battery/completion/health to parity.
 */
export async function resolveWidgetAggregate(
  supabase: SupabaseClient<Database>,
  widget: WidgetAggRow,
): Promise<ActionResult<WidgetAggregatePayload>> {
  if (!widget.source_board_id)
    return {
      ok: true,
      data: { kind: widget.kind, config: {}, buckets: [], columnMeta: null },
    };

  const config = (widget.config ?? {}) as Record<string, unknown>;
  const boardId = widget.source_board_id;

  if (widget.kind === "completion") {
    const result = await resolveCompletion(supabase, { boardId, config });
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
    const result = await resolveHealth(supabase, { boardId });
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

  const result = await resolveAggregate(supabase, { boardId, config });
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
 * series, list → rows, everything else → the aggregate family
 * (number/battery/completion/health) — all of it uncached, over the request's
 * RLS client. This is what lets every widget kind ride the same batched fetch
 * instead of firing a per-widget action each.
 *
 * Lives here rather than in actions.ts because that module is `"use server"`,
 * where every export becomes a public server-action endpoint. The signature is
 * unchanged — it already took the client as a parameter, which is what makes
 * the MCP path a straight reuse.
 *
 * `_widgetId` is kept for call-site/API stability (callers + tests pass it)
 * but is no longer forwarded anywhere — see resolveWidgetAggregate for why.
 */
export async function resolveWidgetSlot(
  supabase: SupabaseClient<Database>,
  _widgetId: string,
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
  const res = await resolveWidgetAggregate(supabase, widget);
  return res.ok ? { ok: true, ...res.data } : { ok: false, error: res.error };
}
