import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  configSchemaForKind,
  createDashboardSchema,
  createWidgetSchema,
  deleteDashboardSchema,
  deleteWidgetSchema,
  duplicateDashboardSchema,
  renameDashboardSchema,
  saveLayoutSchema,
  updateWidgetConfigSchema,
  widgetKindSchema,
} from "@/lib/validations/dashboards";

/**
 * Client-injected cores for every dashboard/widget MUTATION.
 *
 * WHY THIS MODULE EXISTS: `actions.ts` is `"use server"` and its functions get
 * their client from `createClient()` — cookies. An MCP request carries an OAuth
 * bearer token resolved to a bridged client instead, so it cannot call a Server
 * Action at all. Everything that is genuinely the operation — Zod validation,
 * the kind-specific `configSchemaForKind` gate, the RPC/PostgREST statements,
 * the error strings — lives here, taking `supabase` as its first parameter, and
 * BOTH transports call it.
 *
 * What deliberately does NOT live here: `revalidatePath`/`updateTag`. Those are
 * Next.js request-scoped cache primitives; an MCP call has no route to
 * revalidate. Each core returns the ids the Server Action needs (notably the
 * row's `org_id`) so the wrapper can tag exactly what it tagged before.
 */

type Db = SupabaseClient<Database>;
type Widget = Tables<"dashboard_widgets">;
type Dashboard = Tables<"dashboards">;

/** Create a dashboard (the RPC derives org from the workspace). */
export async function createDashboardCore(
  supabase: Db,
  input: { workspaceId: string; name: string },
): Promise<ActionResult<{ dashboard: Dashboard }>> {
  const parsed = createDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { data, error } = await supabase.rpc("create_dashboard", {
    p_workspace_id: parsed.data.workspaceId,
    p_name: parsed.data.name,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not create dashboard.");

  return { ok: true, data: { dashboard: data as Dashboard } };
}

/** Rename a dashboard. RLS enforces org membership; returns the updated row. */
export async function renameDashboardCore(
  supabase: Db,
  input: { dashboardId: string; name: string },
): Promise<ActionResult<{ dashboard: Dashboard }>> {
  const parsed = renameDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { data, error } = await supabase
    .from("dashboards")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.dashboardId)
    .select("*")
    .maybeSingle();
  if (error || !data)
    return fail(error?.message ?? "Could not rename dashboard.");

  return { ok: true, data: { dashboard: data as Dashboard } };
}

/**
 * Delete a dashboard. Widgets cascade via the dashboard_id FK.
 *
 * `orgId` is the deleted row's org — `null` when the delete matched nothing
 * (already gone, or RLS-invisible). The Server Action tags on it; MCP echoes it.
 */
export async function deleteDashboardCore(
  supabase: Db,
  input: { dashboardId: string },
): Promise<ActionResult<{ dashboardId: string; orgId: string | null }>> {
  const parsed = deleteDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Return the deleted row's org_id so the caller can invalidate the cached list.
  const { data, error } = await supabase
    .from("dashboards")
    .delete()
    .eq("id", parsed.data.dashboardId)
    .select("org_id")
    .maybeSingle();
  if (error) return fail(error.message);

  return {
    ok: true,
    data: {
      dashboardId: parsed.data.dashboardId,
      orgId: data ? data.org_id : null,
    },
  };
}

/** Duplicate a dashboard's structure (its widgets) via RPC. */
export async function duplicateDashboardCore(
  supabase: Db,
  input: { dashboardId: string },
): Promise<ActionResult<{ dashboardId: string; orgId: string | null }>> {
  const parsed = duplicateDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

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

  return {
    ok: true,
    data: { dashboardId: data.id, orgId: source ? source.org_id : null },
  };
}

/**
 * Add a widget. Validates the kind-specific config, returns the full row.
 *
 * `configSchemaForKind` IS the guard: a `config` that does not match its kind
 * is what makes the dashboard page throw at render time, for a human, later.
 * It runs before any statement is issued on either transport.
 */
export async function createWidgetCore(
  supabase: Db,
  input: {
    dashboardId: string;
    kind: Widget["kind"];
    sourceBoardId: string;
    title: string;
    config: Record<string, unknown>;
  },
): Promise<ActionResult<{ widget: Widget }>> {
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

  const { data, error } = await supabase.rpc("create_dashboard_widget", {
    p_dashboard_id: parsed.data.dashboardId,
    p_kind: parsed.data.kind,
    p_source_board_id: parsed.data.sourceBoardId,
    p_title: parsed.data.title,
    p_config: cfg.data as Json,
    p_layout: layout as Json,
  });
  if (error || !data) return fail(error?.message ?? "Could not add widget.");

  return { ok: true, data: { widget: data as Widget } };
}

/** Update a widget's title/source/config. Returns the updated row. */
export async function updateWidgetConfigCore(
  supabase: Db,
  input: {
    widgetId: string;
    title?: string;
    sourceBoardId?: string;
    config?: Record<string, unknown>;
  },
): Promise<ActionResult<{ widget: Widget }>> {
  const parsed = updateWidgetConfigSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

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

  return { ok: true, data: { widget: data as Widget } };
}

/** Delete a widget. `orgId` is the deleted row's org, or null if nothing matched. */
export async function deleteWidgetCore(
  supabase: Db,
  input: { widgetId: string },
): Promise<ActionResult<{ widgetId: string; orgId: string | null }>> {
  const parsed = deleteWidgetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Return the deleted row's org_id so the caller can drop its cached aggregation.
  const { data, error } = await supabase
    .from("dashboard_widgets")
    .delete()
    .eq("id", parsed.data.widgetId)
    .select("org_id")
    .maybeSingle();
  if (error) return fail(error.message);

  return {
    ok: true,
    data: {
      widgetId: parsed.data.widgetId,
      orgId: data ? data.org_id : null,
    },
  };
}

/** Persist the grid layout for all widgets in one round-trip (debounced caller). */
export async function saveLayoutCore(
  supabase: Db,
  input: {
    dashboardId: string;
    layouts: { id: string; x: number; y: number; w: number; h: number }[];
  },
): Promise<ActionResult<{ saved: number }>> {
  const parsed = saveLayoutSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const { error } = await supabase.rpc("set_widget_layouts", {
    p_dashboard_id: parsed.data.dashboardId,
    p_layouts: parsed.data.layouts,
  });
  if (error) return fail(error.message);

  return { ok: true, data: { saved: parsed.data.layouts.length } };
}
