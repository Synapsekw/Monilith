import { z } from "zod";
import {
  createWidgetCore,
  deleteWidgetCore,
  updateWidgetConfigCore,
} from "@/lib/dashboards/core";
import { widgetKindSchema } from "@/lib/validations/dashboards";
import {
  parseAction,
  toToolResult,
  type GetClient,
  type ToolResult,
} from "./shared";
import type { ToolDescriptor } from "./descriptor";

const uuid = z.string().uuid();
const widgetTitle = z.string().trim().max(100);
/** Structural gate only. The KIND-specific shape is enforced inside
 *  `createWidgetCore`/`updateWidgetConfigCore` by `configSchemaForKind` — the
 *  guard that stops an agent persisting a config the dashboard page throws on
 *  when a human later opens it. */
const widgetConfig = z.record(z.string(), z.unknown());

/** See the note in `manage-dashboard.ts`: the enum is load-bearing for
 *  `scopeFor`, not decoration. */
export const manageWidgetInput = {
  action: z.enum(["create", "update_config", "delete"]),
  dashboardId: uuid.optional(),
  widgetId: uuid.optional(),
  kind: widgetKindSchema.optional(),
  sourceBoardId: uuid.optional(),
  title: widgetTitle.optional(),
  config: widgetConfig.optional(),
};

const manageWidgetAction = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    dashboardId: uuid,
    kind: widgetKindSchema,
    sourceBoardId: uuid,
    title: widgetTitle.default(""),
    config: widgetConfig,
  }),
  z.object({
    action: z.literal("update_config"),
    widgetId: uuid,
    title: widgetTitle.optional(),
    config: widgetConfig.optional(),
  }),
  z.object({ action: z.literal("delete"), widgetId: uuid }),
]);

type Args = z.infer<typeof manageWidgetAction>;

export async function manageWidgetHandler(
  getClient: GetClient,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseAction(manageWidgetAction, input);
  if (!parsed.ok) return parsed.result;
  const args: Args = parsed.value;

  // ONCE per invocation (rate limit + bridge-secret rotation).
  const supabase = await getClient();

  if (args.action === "create") {
    const res = await createWidgetCore(supabase, {
      dashboardId: args.dashboardId,
      kind: args.kind,
      sourceBoardId: args.sourceBoardId,
      title: args.title,
      config: args.config,
    });
    if (!res.ok) return toToolResult(res);
    const widget = res.data.widget;
    return toToolResult({
      ok: true,
      data: {
        widgetId: widget.id,
        dashboardId: widget.dashboard_id,
        kind: widget.kind,
        title: widget.title,
        boardId: widget.source_board_id,
      },
    });
  }

  if (args.action === "update_config") {
    const res = await updateWidgetConfigCore(supabase, {
      widgetId: args.widgetId,
      // Passed through only when present: an absent key must stay absent, or
      // "leave the title alone" would become "set the title to undefined".
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.config !== undefined ? { config: args.config } : {}),
    });
    if (!res.ok) return toToolResult(res);
    const widget = res.data.widget;
    return toToolResult({
      ok: true,
      data: {
        widgetId: widget.id,
        dashboardId: widget.dashboard_id,
        kind: widget.kind,
        title: widget.title,
        boardId: widget.source_board_id,
      },
    });
  }

  const res = await deleteWidgetCore(supabase, { widgetId: args.widgetId });
  if (!res.ok) return toToolResult(res);
  if (res.data.orgId === null)
    return {
      content: [{ type: "text", text: `Widget ${args.widgetId} not found.` }],
      isError: true,
    };
  return toToolResult({
    ok: true,
    data: { widgetId: res.data.widgetId, deleted: true },
  });
}

export const manageWidgetDescriptor: ToolDescriptor = {
  name: "manage_widget",
  title: "Manage widget",
  description:
    "Add a widget to a dashboard, change an existing widget's title or config, or delete one. `create` needs the `dashboardId` (list_dashboards), a `kind` (number, chart, battery, list, completion or health), the `sourceBoardId` it reads from, and a kind-specific `config` — CALL describe_schema FIRST for the exact `config` shape each kind requires; a config that does not match its kind is rejected rather than saved. `update_config` takes a `widgetId` from get_dashboard and only the fields you are changing. Read a widget's numbers with get_widget_data.",
  inputSchema: manageWidgetInput,
  capability: {
    create: "board.structure",
    update_config: "board.structure",
    delete: "board.destroy",
  },
  // Like manage_dashboard: a widget is reached through a dashboard/widget id,
  // not a board id, so board_scope has nothing to resolve and RLS is the
  // boundary. (A widget does name one `sourceBoardId`, but the row it edits is
  // addressed by widget id — narrowing on the source board would be a
  // half-guard that misses `delete` and `update_config` entirely.)
  scope: { create: "none", update_config: "none", delete: "none" },
  // DELIBERATELY no `unscopedCreateActions`: unlike a dashboard, goal,
  // portfolio or report, a widget is not a new top-level object — it hangs off
  // a dashboard the caller must already name, so a narrowed agent creating one
  // is not reaching outside anything it was not already given.
  invoke: (ctx, input) => manageWidgetHandler(ctx.getClient, input),
};
