"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { optionSchema } from "@/lib/validations/boards";
import {
  type AggregateBucket,
  type ColumnMeta,
} from "@/lib/dashboards/widget-data";
import {
  configSchemaForKind,
  createDashboardSchema,
  createWidgetSchema,
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

  revalidatePath(`/dashboards/${parsed.data.dashboardId}`);
  revalidatePath("/dashboards");
  return { ok: true, data: { dashboard: data as Tables<"dashboards"> } };
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

  revalidatePath(`/dashboards/${parsed.data.dashboardId}`);
  return { ok: true, data: { widget: data as Widget } };
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
  const { error } = await supabase
    .from("dashboard_widgets")
    .delete()
    .eq("id", parsed.data.widgetId);
  if (error) return fail(error.message);

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
    .select("kind, config, source_board_id")
    .eq("id", parsed.data.widgetId)
    .maybeSingle();
  if (!widget) return fail("Widget not found.");
  if (!widget.source_board_id)
    return {
      ok: true,
      data: { kind: widget.kind, config: {}, buckets: [], columnMeta: null },
    };

  const config = (widget.config ?? {}) as Record<string, unknown>;
  const agg = (config.agg as string) ?? "count";
  const { data, error } = await supabase.rpc("dashboard_aggregate", {
    p_board_id: widget.source_board_id,
    p_group_column_id: (config.groupColumnId as string) ?? undefined,
    p_value_column_id: (config.valueColumnId as string) ?? undefined,
    p_agg: agg,
  });
  if (error) return fail(error.message);

  const buckets: AggregateBucket[] = (data ?? []).map((r) => ({
    group_key: r.group_key,
    metric: Number(r.metric),
  }));

  // For grouped widgets, resolve the group column's options for label/color
  // rendering (kept server-side so renames/recolors reflect without a stale snapshot).
  let columnMeta: ColumnMeta | null = null;
  const groupColumnId = config.groupColumnId as string | undefined;
  if (groupColumnId) {
    const { data: col } = await supabase
      .from("columns")
      .select("kind, settings")
      .eq("id", groupColumnId)
      .maybeSingle();
    if (col) {
      const opts = optionSchema
        .array()
        .safeParse((col.settings as { options?: unknown }).options ?? []);
      columnMeta = { kind: col.kind, options: opts.success ? opts.data : [] };
    }
  }

  return { ok: true, data: { kind: widget.kind, config, buckets, columnMeta } };
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
