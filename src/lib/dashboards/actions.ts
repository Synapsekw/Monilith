"use server";

import { revalidatePath, updateTag } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { dashboardsTag, widgetAggregationTag } from "@/lib/cache/tags";
import {
  getWidgetAggregationCached,
  getWidgetCompletionCached,
  getWidgetHealthCached,
} from "@/lib/dashboards/queries-cached";
import {
  type AggregateBucket,
  type ColumnMeta,
  type CompletionGroupRow,
  type GroupMeta,
  type HealthCounts,
} from "@/lib/dashboards/widget-data";
import { resolveSeries, resolveRows } from "@/lib/dashboards/widget-resolve";
import type { SeriesData } from "@/lib/dashboards/series";
import {
  configSchemaForKind,
  createDashboardSchema,
  createWidgetSchema,
  deleteDashboardSchema,
  duplicateDashboardSchema,
  deleteWidgetSchema,
  getWidgetDataSchema,
  getWidgetsDataSchema,
  renameDashboardSchema,
  saveLayoutSchema,
  updateWidgetConfigSchema,
  widgetKindSchema,
} from "@/lib/validations/dashboards";
import type { Json, Tables } from "@/types/database.types";
import type { DisplayColumn } from "@/lib/dashboards/list-rows";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

type Widget = Tables<"dashboard_widgets">;

/** Create a dashboard (server derives org from workspace). */
export async function createDashboard(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<{ dashboard: Tables<"dashboards"> }>> {
  const parsed = createDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_dashboard", {
    p_workspace_id: parsed.data.workspaceId,
    p_name: parsed.data.name,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not create dashboard.");

  // Invalidate the cached org dashboards list (read-your-own-writes).
  updateTag(dashboardsTag((data as Tables<"dashboards">).org_id));
  revalidatePath("/dashboards");
  return { ok: true, data: { dashboard: data as Tables<"dashboards"> } };
}

/** Rename a dashboard. RLS enforces org membership; returns the updated row. */
export async function renameDashboard(input: {
  dashboardId: string;
  name: string;
}): Promise<ActionResult<{ dashboard: Tables<"dashboards"> }>> {
  const parsed = renameDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dashboards")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.dashboardId)
    .select("*")
    .maybeSingle();
  if (error || !data)
    return fail(error?.message ?? "Could not rename dashboard.");

  updateTag(dashboardsTag((data as Tables<"dashboards">).org_id));
  revalidatePath(`/dashboards/${parsed.data.dashboardId}`);
  revalidatePath("/dashboards");
  return { ok: true, data: { dashboard: data as Tables<"dashboards"> } };
}

/** Delete a dashboard. Widgets cascade via the dashboard_id FK. */
export async function deleteDashboard(input: {
  dashboardId: string;
}): Promise<ActionResult<undefined>> {
  const parsed = deleteDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // Return the deleted row's org_id so we can invalidate the cached list.
  const { data, error } = await supabase
    .from("dashboards")
    .delete()
    .eq("id", parsed.data.dashboardId)
    .select("org_id")
    .maybeSingle();
  if (error) return fail(error.message);

  if (data) updateTag(dashboardsTag(data.org_id));
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
  const parsed = duplicateDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // The copy lands in the same org as the source — read it for the cache tag.
  const { data: source } = await supabase
    .from("dashboards")
    .select("org_id")
    .eq("id", parsed.data.dashboardId)
    .maybeSingle();
  const { data, error } = await supabase.rpc("duplicate_dashboard", {
    p_dashboard_id: parsed.data.dashboardId,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not duplicate dashboard.");

  if (source) updateTag(dashboardsTag(source.org_id));
  // Narrow to the dashboards index; sidebar/palette lists are served from the
  // `dashboards:org` cache the updateTag above expired. The client navigates to
  // the new copy. Mirrors createDashboard/renameDashboard.
  revalidatePath("/dashboards");
  return { ok: true, data: { dashboardId: data.id } };
}

/** Add a widget. Validates the kind-specific config, returns the full row. */
export async function createWidget(input: {
  dashboardId: string;
  kind: Widget["kind"];
  sourceBoardId: string;
  title: string;
  config: Record<string, unknown>;
}): Promise<ActionResult<{ widget: Widget }>> {
  const parsed = createWidgetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const cfg = configSchemaForKind(parsed.data.kind).safeParse(
    parsed.data.config,
  );
  if (!cfg.success)
    return fail(cfg.error.issues[0]?.message ?? "Invalid widget config");

  // Default starting layout: a 3×2 tile at the origin (the canvas relays out on add).
  const layout = { x: 0, y: 0, w: 3, h: 2 };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_dashboard_widget", {
    p_dashboard_id: parsed.data.dashboardId,
    p_kind: parsed.data.kind,
    p_source_board_id: parsed.data.sourceBoardId,
    p_title: parsed.data.title,
    p_config: cfg.data as Json,
    p_layout: layout as Json,
  });
  if (error || !data) return fail(error?.message ?? "Could not add widget.");

  const widget = data as Widget;
  // Read-your-own-writes: invalidate this widget's cached aggregation so the
  // first load reflects the brand-new config (not a stale/empty entry).
  updateTag(widgetAggregationTag(widget.org_id, widget.id));
  revalidatePath(`/dashboards/${parsed.data.dashboardId}`);
  return { ok: true, data: { widget } };
}

/** Update a widget's title/source/config. Returns the updated row. */
export async function updateWidgetConfig(input: {
  widgetId: string;
  title?: string;
  sourceBoardId?: string;
  config?: Record<string, unknown>;
}): Promise<ActionResult<{ widget: Widget }>> {
  const parsed = updateWidgetConfigSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  // Validate config against the widget's actual kind (read it first).
  const patch: Partial<Widget> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.sourceBoardId !== undefined)
    patch.source_board_id = parsed.data.sourceBoardId;
  if (parsed.data.config !== undefined) {
    const { data: existing } = await supabase
      .from("dashboard_widgets")
      .select("kind")
      .eq("id", parsed.data.widgetId)
      .maybeSingle();
    if (!existing) return fail("Widget not found.");
    // The DB enum can be ahead of this build (a widget kind added by a newer
    // migration before its handling ships here) — validate at the boundary.
    const kind = widgetKindSchema.safeParse(existing.kind);
    if (!kind.success) return fail("Unsupported widget kind.");
    const cfg = configSchemaForKind(kind.data).safeParse(parsed.data.config);
    if (!cfg.success)
      return fail(cfg.error.issues[0]?.message ?? "Invalid widget config");
    patch.config = cfg.data as Json;
  }

  const { data, error } = await supabase
    .from("dashboard_widgets")
    .update(patch)
    .eq("id", parsed.data.widgetId)
    .select("*")
    .maybeSingle();
  if (error || !data) return fail(error?.message ?? "Could not update widget.");

  // Read-your-own-writes: a config edit changes the aggregation inputs, so drop
  // this widget's cached entry immediately (board-data edits stay TTL-bounded).
  updateTag(widgetAggregationTag(data.org_id, parsed.data.widgetId));
  revalidatePath(`/dashboards/${data.dashboard_id}`);
  return { ok: true, data: { widget: data as Widget } };
}

/** Delete a widget. */
export async function deleteWidget(input: {
  widgetId: string;
}): Promise<ActionResult<{ widgetId: string }>> {
  const parsed = deleteWidgetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // Return the deleted row's org_id so we can drop its cached aggregation.
  const { data, error } = await supabase
    .from("dashboard_widgets")
    .delete()
    .eq("id", parsed.data.widgetId)
    .select("org_id")
    .maybeSingle();
  if (error) return fail(error.message);
  if (data) updateTag(widgetAggregationTag(data.org_id, parsed.data.widgetId));

  return { ok: true, data: { widgetId: parsed.data.widgetId } };
}

/** Persist the grid layout for all widgets in one round-trip (debounced caller). */
export async function saveLayout(input: {
  dashboardId: string;
  layouts: { id: string; x: number; y: number; w: number; h: number }[];
}): Promise<ActionResult<{ saved: number }>> {
  const parsed = saveLayoutSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_widget_layouts", {
    p_dashboard_id: parsed.data.dashboardId,
    p_layouts: parsed.data.layouts,
  });
  if (error) return fail(error.message);

  return { ok: true, data: { saved: parsed.data.layouts.length } };
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

/** The per-widget slot in a batched result — a discriminated union so one
 *  widget's failed aggregation surfaces as an error without blanking the rest. */
export type WidgetDataResult =
  | ({ ok: true } & WidgetAggregatePayload)
  | { ok: false; error: string };

/** The columns a widget row must carry to resolve its aggregation. Shared by the
 *  single (`.eq`) and batched (`.in`) reads so both trust the DB row, never the
 *  client — RLS scopes which rows are visible. */
type WidgetAggRow = {
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
async function resolveWidgetAggregate(
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

  return resolveWidgetAggregate(parsed.data.widgetId, widget);
}

/**
 * Batched widget-data fetch: resolves every requested widget's aggregate in a
 * single client→server round-trip (Next serializes Server Action POSTs, so N
 * per-widget calls populate a dashboard sequentially — this collapses them to
 * one). Authorization re-reads the widget rows server-side in ONE `.in("id")`
 * query (RLS scopes visibility; the client-passed ids are never trusted for
 * board/org access), then computes all aggregations concurrently with
 * `Promise.all`, reusing the same per-widget cached read. Returns a map keyed by
 * widget id whose slots are independent: one widget's failure never blanks the
 * others. Ids the caller can't see are simply absent from the map.
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
      const res = await resolveWidgetAggregate(widget.id, widget);
      const slot: WidgetDataResult = res.ok
        ? { ok: true, ...res.data }
        : { ok: false, error: res.error };
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
