"use server";

import { revalidatePath, updateTag } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { dashboardsTag, widgetAggregationTag } from "@/lib/cache/tags";
import {
  type AggregateBucket,
  type ColumnMeta,
  type CompletionGroupRow,
  type GroupMeta,
  type HealthCounts,
} from "@/lib/dashboards/widget-data";
import {
  resolveAggregate,
  resolveCompletion,
  resolveHealth,
  resolveSeries,
  resolveRows,
  type WidgetRowsData,
} from "@/lib/dashboards/widget-resolve";
import {
  resolveWidgetAggregate,
  resolveWidgetSlot,
} from "@/lib/dashboards/widget-slot-core";
import type { SeriesData } from "@/lib/dashboards/series";
import {
  configSchemaForKind,
  getWidgetDataSchema,
  getWidgetsDataSchema,
  getWidgetPreviewDataSchema,
  widgetKindSchema,
} from "@/lib/validations/dashboards";
import {
  createDashboardCore,
  createWidgetCore,
  deleteDashboardCore,
  deleteWidgetCore,
  duplicateDashboardCore,
  renameDashboardCore,
  saveLayoutCore,
  updateWidgetConfigCore,
} from "@/lib/dashboards/core";
import type { Tables } from "@/types/database.types";
import type { DisplayColumn } from "@/lib/dashboards/list-rows";
import { fail, type ActionResult } from "@/lib/actions/result";

type Widget = Tables<"dashboard_widgets">;

/**
 * Every mutation below is a thin cookie-bound wrapper: it supplies the
 * request's RLS client to the matching core in `./core`, then does the ONE
 * thing a core cannot — expire this deployment's caches. The core holds the
 * validation, the guards and the statements, so the MCP transport
 * (`src/lib/mcp/tools/manage-dashboard.ts`, `manage-widget.ts`) runs exactly
 * the same code with a bridged client.
 */

/** Create a dashboard (server derives org from workspace). */
export async function createDashboard(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<{ dashboard: Tables<"dashboards"> }>> {
  const supabase = await createClient();
  const res = await createDashboardCore(supabase, input);
  if (!res.ok) return res;

  // Invalidate the cached org dashboards list (read-your-own-writes).
  updateTag(dashboardsTag(res.data.dashboard.org_id));
  revalidatePath("/dashboards");
  return res;
}

/** Rename a dashboard. RLS enforces org membership; returns the updated row. */
export async function renameDashboard(input: {
  dashboardId: string;
  name: string;
}): Promise<ActionResult<{ dashboard: Tables<"dashboards"> }>> {
  const supabase = await createClient();
  const res = await renameDashboardCore(supabase, input);
  if (!res.ok) return res;

  updateTag(dashboardsTag(res.data.dashboard.org_id));
  revalidatePath(`/dashboards/${input.dashboardId}`);
  revalidatePath("/dashboards");
  return res;
}

/** Delete a dashboard. Widgets cascade via the dashboard_id FK. */
export async function deleteDashboard(input: {
  dashboardId: string;
}): Promise<ActionResult<undefined>> {
  const supabase = await createClient();
  const res = await deleteDashboardCore(supabase, input);
  if (!res.ok) return res;

  if (res.data.orgId) updateTag(dashboardsTag(res.data.orgId));
  // Narrow to the dashboards index (its redirect picks the first remaining
  // dashboard); the sidebar/palette lists are served from the `dashboards:org`
  // cache the updateTag above expired. Mirrors createDashboard/renameDashboard.
  revalidatePath("/dashboards");
  return { ok: true, data: undefined };
}

/** Duplicate a dashboard's structure (its widgets) via RPC. */
export async function duplicateDashboard(input: {
  dashboardId: string;
}): Promise<ActionResult<{ dashboardId: string }>> {
  const supabase = await createClient();
  const res = await duplicateDashboardCore(supabase, input);
  if (!res.ok) return res;

  if (res.data.orgId) updateTag(dashboardsTag(res.data.orgId));
  // Narrow to the dashboards index; sidebar/palette lists are served from the
  // `dashboards:org` cache the updateTag above expired. The client navigates to
  // the new copy. Mirrors createDashboard/renameDashboard.
  revalidatePath("/dashboards");
  return { ok: true, data: { dashboardId: res.data.dashboardId } };
}

/** Add a widget. Validates the kind-specific config, returns the full row. */
export async function createWidget(input: {
  dashboardId: string;
  kind: Widget["kind"];
  sourceBoardId: string;
  title: string;
  config: Record<string, unknown>;
}): Promise<ActionResult<{ widget: Widget }>> {
  const supabase = await createClient();
  const res = await createWidgetCore(supabase, input);
  if (!res.ok) return res;

  const widget = res.data.widget;
  // Read-your-own-writes: invalidate this widget's cached aggregation so the
  // first load reflects the brand-new config (not a stale/empty entry).
  updateTag(widgetAggregationTag(widget.org_id, widget.id));
  revalidatePath(`/dashboards/${input.dashboardId}`);
  return res;
}

/** Update a widget's title/source/config. Returns the updated row. */
export async function updateWidgetConfig(input: {
  widgetId: string;
  title?: string;
  sourceBoardId?: string;
  config?: Record<string, unknown>;
}): Promise<ActionResult<{ widget: Widget }>> {
  const supabase = await createClient();
  const res = await updateWidgetConfigCore(supabase, input);
  if (!res.ok) return res;

  const widget = res.data.widget;
  // Read-your-own-writes: a config edit changes the aggregation inputs, so drop
  // this widget's cached entry immediately (board-data edits stay TTL-bounded).
  updateTag(widgetAggregationTag(widget.org_id, widget.id));
  revalidatePath(`/dashboards/${widget.dashboard_id}`);
  return res;
}

/** Delete a widget. */
export async function deleteWidget(input: {
  widgetId: string;
}): Promise<ActionResult<{ widgetId: string }>> {
  const supabase = await createClient();
  const res = await deleteWidgetCore(supabase, input);
  if (!res.ok) return res;

  if (res.data.orgId)
    updateTag(widgetAggregationTag(res.data.orgId, res.data.widgetId));

  return { ok: true, data: { widgetId: res.data.widgetId } };
}

/** Persist the grid layout for all widgets in one round-trip (debounced caller). */
export async function saveLayout(input: {
  dashboardId: string;
  layouts: { id: string; x: number; y: number; w: number; h: number }[];
}): Promise<ActionResult<{ saved: number }>> {
  const supabase = await createClient();
  return saveLayoutCore(supabase, input);
}

/** A widget's resolved aggregate payload (success shape shared by the single +
 *  batched fetches). */
export type WidgetAggregatePayload = {
  kind: Widget["kind"];
  config: Record<string, unknown>;
  buckets: AggregateBucket[];
  columnMeta: ColumnMeta | null;
  /** Present only for completion widgets. */
  completion?: { rows: CompletionGroupRow[]; groups: GroupMeta[] };
  /** Present only for health widgets. */
  health?: HealthCounts;
};

/** A chart widget's batched slot — its resolved series. Tagged with `shape` so
 *  it discriminates cleanly from the (untagged) aggregate slot. */
export type WidgetSeriesSlot = {
  ok: true;
  shape: "series";
  series: SeriesData;
};
/** A list widget's batched slot — its resolved rows. */
export type WidgetRowsSlot = { ok: true; shape: "rows"; rows: WidgetRowsData };

/** The per-widget slot in a batched result — a discriminated union so one
 *  widget's failed resolve surfaces as an error without blanking the rest.
 *  Aggregate widgets (number/battery/completion/health) carry the untagged
 *  {@link WidgetAggregatePayload} (identified by its `buckets` field); chart and
 *  list widgets carry a `shape`-tagged series/rows slot. Folding all three
 *  families into one map lets a dashboard fetch every widget in one round-trip. */
export type WidgetDataResult =
  | ({ ok: true } & WidgetAggregatePayload)
  | WidgetSeriesSlot
  | WidgetRowsSlot
  | { ok: false; error: string };

/** Fetch a widget's bounded aggregate data. Reads the widget, runs the RPC. */
export async function getWidgetData(input: {
  widgetId: string;
}): Promise<ActionResult<WidgetAggregatePayload>> {
  const parsed = getWidgetDataSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: widget } = await supabase
    .from("dashboard_widgets")
    .select("kind, config, source_board_id, org_id")
    .eq("id", parsed.data.widgetId)
    .maybeSingle();
  if (!widget) return fail("Widget not found.");

  return resolveWidgetAggregate(supabase, widget);
}

/**
 * Batched widget-data fetch: resolves every requested widget in a single
 * client→server round-trip (Next serializes Server Action POSTs, so N per-widget
 * calls populate a dashboard sequentially — this collapses them to one). Handles
 * ALL widget families — aggregate (number/battery/completion/health), chart
 * (series) and list (rows) — so a dashboard with N chart/list widgets no longer
 * fires N extra actions. Authorization re-reads the widget rows server-side in
 * ONE `.in("id")` query (RLS scopes visibility; client-passed ids are never
 * trusted for board/org access), then resolves each slot concurrently with
 * `Promise.all`. Returns a map keyed by widget id whose slots are independent:
 * one widget's failure never blanks the others. Ids the caller can't see are
 * simply absent from the map.
 */
export async function getWidgetsData(input: {
  widgetIds: string[];
}): Promise<ActionResult<{ results: Record<string, WidgetDataResult> }>> {
  const parsed = getWidgetsDataSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  if (parsed.data.widgetIds.length === 0)
    return { ok: true, data: { results: {} } };

  const supabase = await createClient();
  const { data: widgets, error } = await supabase
    .from("dashboard_widgets")
    .select("id, kind, config, source_board_id, org_id")
    .in("id", parsed.data.widgetIds);
  if (error) return fail(error.message);

  const entries = await Promise.all(
    (widgets ?? []).map(async (widget) => {
      const slot = await resolveWidgetSlot(supabase, widget.id, widget);
      return [widget.id, slot] as const;
    }),
  );

  return { ok: true, data: { results: Object.fromEntries(entries) } };
}

/**
 * Bounded row fetch for a List widget: the most recent `limit` items of the
 * source board + their cell values for the chosen columns. RLS-scoped plain
 * selects (board_id indexed; LIMIT bounds the read). No grouping.
 */
export async function getWidgetRows(input: { widgetId: string }): Promise<
  ActionResult<{
    columns: DisplayColumn[];
    rows: { itemId: string; name: string; cells: Record<string, unknown> }[];
  }>
> {
  const parsed = getWidgetDataSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: widget } = await supabase
    .from("dashboard_widgets")
    .select("config, source_board_id")
    .eq("id", parsed.data.widgetId)
    .maybeSingle();
  if (!widget) return fail("Widget not found.");
  if (!widget.source_board_id)
    return { ok: true, data: { columns: [], rows: [] } };

  return resolveRows(supabase, {
    boardId: widget.source_board_id,
    config: (widget.config ?? {}) as Record<string, unknown>,
  });
}

export async function getWidgetSeries(input: {
  widgetId: string;
}): Promise<ActionResult<SeriesData>> {
  const parsed = getWidgetDataSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: widget } = await supabase
    .from("dashboard_widgets")
    .select("config, source_board_id, org_id")
    .eq("id", parsed.data.widgetId)
    .maybeSingle();
  if (!widget) return fail("Widget not found.");

  return resolveSeries(supabase, {
    boardId: widget.source_board_id ?? "",
    orgId: widget.org_id,
    config: (widget.config ?? {}) as Record<string, unknown>,
  });
}

/** Result of a single draft preview fetch — one shape per widget family. */
export type WidgetPreviewResult =
  | { ok: true; shape: "aggregate"; payload: WidgetAggregatePayload }
  | { ok: true; shape: "series"; payload: SeriesData }
  | { ok: true; shape: "rows"; payload: WidgetRowsData }
  | { ok: false; error: string };

/**
 * Resolve a *draft* widget's data for the config-sheet live preview. Unlike the
 * id-keyed reads, the config is unsaved client draft state, so it's passed in
 * directly. Authorization: re-read the board row with the RLS-scoped client to
 * derive org_id — a board the caller can't see is absent ⇒ error. The config is
 * Zod-validated per kind; a transiently-invalid draft yields a neutral empty
 * payload (the preview shows the widget's own configure/empty state), matching
 * how half-configured live widgets render. Uncached: every draft is fresh.
 */
export async function getWidgetPreviewData(input: {
  kind: Widget["kind"];
  sourceBoardId: string;
  config: Record<string, unknown>;
}): Promise<ActionResult<WidgetPreviewResult>> {
  const parsed = getWidgetPreviewDataSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Validate the kind-specific shape; invalid drafts render as neutral/empty.
  const kindParsed = widgetKindSchema.safeParse(parsed.data.kind);
  if (!kindParsed.success) return fail("Unsupported widget kind.");
  const cfg = configSchemaForKind(kindParsed.data).safeParse(
    parsed.data.config,
  );
  const config = cfg.success ? (cfg.data as Record<string, unknown>) : null;

  const supabase = await createClient();
  // Tenant boundary: derive org from an RLS-visible board row, never the client.
  const { data: board } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", parsed.data.sourceBoardId)
    .maybeSingle();
  if (!board) return fail("Board not found.");
  const orgId = board.org_id;
  const boardId = parsed.data.sourceBoardId;

  // Chart + list.
  if (kindParsed.data === "chart") {
    if (!config)
      return {
        ok: true,
        data: {
          ok: true,
          shape: "series",
          payload: {
            chartType: "bar",
            primaryKind: "date",
            seriesKind: null,
            points: [],
          },
        },
      };
    const r = await resolveSeries(supabase, { boardId, orgId, config });
    return r.ok
      ? { ok: true, data: { ok: true, shape: "series", payload: r.data } }
      : { ok: true, data: { ok: false, error: r.error } };
  }
  if (kindParsed.data === "list") {
    if (!config)
      return {
        ok: true,
        data: { ok: true, shape: "rows", payload: { columns: [], rows: [] } },
      };
    const r = await resolveRows(supabase, { boardId, config });
    return r.ok
      ? { ok: true, data: { ok: true, shape: "rows", payload: r.data } }
      : { ok: true, data: { ok: false, error: r.error } };
  }

  // Aggregate family (number / battery / completion / health).
  if (!config)
    return {
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: kindParsed.data,
          config: {},
          buckets: [],
          columnMeta: null,
        },
      },
    };

  if (kindParsed.data === "completion") {
    const r = await resolveCompletion(supabase, { boardId, config });
    if (!r.ok) return { ok: true, data: { ok: false, error: r.error } };
    return {
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: kindParsed.data,
          config,
          buckets: [],
          columnMeta: null,
          completion: { rows: r.rows, groups: r.groups },
        },
      },
    };
  }
  if (kindParsed.data === "health") {
    const r = await resolveHealth(supabase, { boardId });
    if (!r.ok) return { ok: true, data: { ok: false, error: r.error } };
    return {
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: kindParsed.data,
          config,
          buckets: [],
          columnMeta: null,
          health: r.counts,
        },
      },
    };
  }
  // number / battery
  const r = await resolveAggregate(supabase, { boardId, config });
  if (!r.ok) return { ok: true, data: { ok: false, error: r.error } };
  return {
    ok: true,
    data: {
      ok: true,
      shape: "aggregate",
      payload: {
        kind: kindParsed.data,
        config,
        buckets: r.buckets,
        columnMeta: r.columnMeta,
      },
    },
  };
}
