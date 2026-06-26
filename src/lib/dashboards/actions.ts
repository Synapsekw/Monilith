"use server";

import { revalidatePath, updateTag } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { dashboardsTag, widgetAggregationTag } from "@/lib/cache/tags";
import { getWidgetAggregationCached } from "@/lib/dashboards/queries-cached";
import { optionSchema } from "@/lib/validations/boards";
import {
  type AggregateBucket,
  type ColumnMeta,
} from "@/lib/dashboards/widget-data";
import { normalizeChartConfig } from "@/lib/dashboards/chart-config";
import type { SeriesData, SeriesPoint } from "@/lib/dashboards/series";
import {
  configSchemaForKind,
  createDashboardSchema,
  createWidgetSchema,
  deleteDashboardSchema,
  duplicateDashboardSchema,
  deleteWidgetSchema,
  getWidgetDataSchema,
  renameDashboardSchema,
  saveLayoutSchema,
  updateWidgetConfigSchema,
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
  revalidatePath("/", "layout");
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
  revalidatePath("/", "layout");
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
    const cfg = configSchemaForKind(existing.kind).safeParse(
      parsed.data.config,
    );
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

/** Fetch a widget's bounded aggregate data. Reads the widget, runs the RPC. */
export async function getWidgetData(input: { widgetId: string }): Promise<
  ActionResult<{
    kind: Widget["kind"];
    config: Record<string, unknown>;
    buckets: AggregateBucket[];
    columnMeta: ColumnMeta | null;
  }>
> {
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
  if (!widget.source_board_id)
    return {
      ok: true,
      data: { kind: widget.kind, config: {}, buckets: [], columnMeta: null },
    };

  const config = (widget.config ?? {}) as Record<string, unknown>;
  // Delegate the aggregation read to the cached query (Phase 9.3b). The widget's
  // org + board are resolved above and passed in, so `orgId` is part of the cache
  // key + tag — cross-tenant isolation holds by construction. The cached fn also
  // resolves the group column's options server-side (so renames/recolors reflect
  // without a stale client snapshot), bounded by the short `widget` TTL.
  const result = await getWidgetAggregationCached({
    widgetId: parsed.data.widgetId,
    orgId: widget.org_id,
    boardId: widget.source_board_id,
    config,
    groupColumnId: (config.groupColumnId as string | undefined) ?? null,
  });
  if (result.error) return fail(result.error);

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

  const config = (widget.config ?? {}) as {
    columnIds?: string[];
    limit?: number;
    filter?: unknown;
  };
  const columnIds = Array.isArray(config.columnIds) ? config.columnIds : [];
  const limit = Math.min(Math.max(config.limit ?? 25, 1), 100);

  // Bounded, indexed, membership-checked row fetch — LIMIT applied after the
  // filter inside the RPC (D3b). Empty/absent filter ⇒ latest-N (D3a parity).
  const { data: items } = await supabase.rpc("dashboard_list_rows", {
    p_board_id: widget.source_board_id,
    p_filter: (config.filter ?? {}) as Json,
    p_limit: limit,
  });
  const itemIds = (items ?? []).map((i) => i.item_id);

  let columns: DisplayColumn[] = [];
  const cellMap = new Map<string, unknown>(); // `${itemId}:${columnId}` → value
  if (columnIds.length > 0) {
    const { data: cols } = await supabase
      .from("columns")
      .select("id, name, kind, settings")
      .in("id", columnIds);
    columns = (cols ?? [])
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        options:
          optionSchema
            .array()
            .safeParse((c.settings as { options?: unknown }).options ?? [])
            .data ?? [],
      }))
      // preserve the config's column order
      .sort((a, b) => columnIds.indexOf(a.id) - columnIds.indexOf(b.id));

    if (itemIds.length > 0) {
      const { data: cells } = await supabase
        .from("cell_values")
        .select("item_id, column_id, value")
        .eq("board_id", widget.source_board_id)
        .in("item_id", itemIds)
        .in("column_id", columnIds);
      for (const cell of cells ?? [])
        cellMap.set(`${cell.item_id}:${cell.column_id}`, cell.value);
    }
  }

  const rows = (items ?? []).map((it) => ({
    itemId: it.item_id,
    name: it.name,
    cells: Object.fromEntries(
      columnIds.map((cid) => [
        cid,
        cellMap.get(`${it.item_id}:${cid}`) ?? null,
      ]),
    ),
  }));

  return { ok: true, data: { columns, rows } };
}

const PALETTE = [
  "var(--brand)",
  "var(--status-green)",
  "var(--status-orange)",
  "var(--status-purple)",
  "var(--status-teal)",
  "var(--status-red)",
  "var(--status-yellow)",
  "var(--status-blue)",
];

function formatBucketLabel(key: string, bucket: string): string {
  // key is "YYYY-MM-DD" (start of bucket)
  const d = new Date(key);
  if (Number.isNaN(d.getTime())) return key;
  if (bucket === "month")
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  const cfg = normalizeChartConfig(
    (widget.config ?? {}) as Record<string, unknown>,
  );
  const empty: SeriesData = {
    chartType: cfg.chartType,
    primaryKind: cfg.primary.kind,
    seriesKind: cfg.series?.kind ?? null,
    points: [],
  };
  if (
    !widget.source_board_id ||
    (cfg.primary.kind !== "date" && !cfg.primary.columnId)
  )
    return { ok: true, data: empty };

  // `dashboard_series` is not yet in database.types.ts — Task 1.5 regenerates it.
  // Until then we use an `any` cast (justified: the type will be added in T1.5).
  type SeriesRow = {
    primary_key: string | null;
    series_key: string | null;
    value: number;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpcResult = (await (supabase as any).rpc("dashboard_series", {
    p_board_id: widget.source_board_id,
    p_primary: cfg.primary as Json,
    p_series: (cfg.series ?? null) as Json,
    p_measure: cfg.measure as Json,
    p_limit: 12,
  })) as { data: SeriesRow[] | null; error: { message: string } | null };
  if (rpcResult.error) return fail(rpcResult.error.message);
  const raw = rpcResult.data;

  const orgId = widget.org_id;

  // Resolve a key -> {label,color} map for a dimension.
  // NOTE: org_members → profiles has no declared FK in database.types.ts (user_id
  // references auth.users, not profiles), so a PostgREST embed won't typecheck.
  // We use a two-query JS join instead, matching the existing pattern in
  // src/lib/boards/queries.ts::listOrgMembers.
  async function resolver(dim: { kind: string; columnId?: string }) {
    const map = new Map<string, { label: string; color: string }>();
    if (dim.kind === "status" || dim.kind === "dropdown") {
      if (!dim.columnId) return map;
      const { data: col } = await supabase
        .from("columns")
        .select("settings")
        .eq("id", dim.columnId)
        .maybeSingle();
      const opts =
        optionSchema
          .array()
          .safeParse((col?.settings as { options?: unknown })?.options ?? [])
          .data ?? [];
      opts.forEach((o) => map.set(o.id, { label: o.label, color: o.color }));
    } else if (dim.kind === "people") {
      // Two-query JS join: fetch org_members user_ids (scoped to this widget's
      // org, matching src/lib/boards/queries.ts::listOrgMembers), then fetch
      // profiles by id. The org_id filter keeps the member set + palette indices
      // deterministic for multi-org users (RLS alone would merge orgs).
      const { data: members } = await supabase
        .from("org_members")
        .select("user_id")
        .eq("org_id", orgId);
      const userIds = (members ?? []).map((m) => m.user_id);
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        (profiles ?? []).forEach((p, i) =>
          map.set(p.id, {
            label: p.full_name ?? "Member",
            color: PALETTE[i % PALETTE.length],
          }),
        );
      }
    }
    return map;
  }

  const primaryMap = await resolver(cfg.primary);
  const seriesMap = cfg.series ? await resolver(cfg.series) : new Map();

  const points: SeriesPoint[] = (raw ?? []).map((r, i) => {
    const pk = r.primary_key;
    const sk = r.series_key;
    const primaryLabel =
      pk === null
        ? "None"
        : pk === "__other__"
          ? "Other"
          : cfg.primary.kind === "date"
            ? formatBucketLabel(pk, cfg.primary.bucket ?? "month")
            : (primaryMap.get(pk)?.label ?? "Unknown");
    const seriesLabel =
      sk === null
        ? null
        : (seriesMap.get(sk)?.label ??
          (sk === "__other__" ? "Other" : "Unknown"));
    const seriesColor =
      (sk !== null
        ? seriesMap.get(sk!)?.color
        : primaryMap.get(pk ?? "")?.color) ?? PALETTE[i % PALETTE.length];
    return {
      primaryKey: pk,
      primaryLabel,
      seriesKey: sk,
      seriesLabel,
      seriesColor,
      value: Number(r.value),
    };
  });

  return {
    ok: true,
    data: { ...empty, points },
  };
}
