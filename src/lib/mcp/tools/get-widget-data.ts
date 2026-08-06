import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveWidgetSlot } from "@/lib/dashboards/widget-slot-core";
import type { GetClient, ToolResult } from "./shared";

export async function getWidgetDataHandler(
  getClient: GetClient,
  args: { widgetId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    // Re-read the widget through RLS — a client-supplied id is never trusted
    // for board/org access (the same rule getWidgetsData applies).
    const { data: widget, error } = await supabase
      .from("dashboard_widgets")
      .select("kind, config, source_board_id, org_id")
      .eq("id", args.widgetId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load widget: ${error.message}`);
    if (!widget)
      return {
        content: [{ type: "text", text: `Widget ${args.widgetId} not found.` }],
        isError: true,
      };

    // The widget row is org-scoped (any org member can see it), but the board
    // it aggregates over is narrower — creator or an explicit board_members
    // row (`can_read_board`). `resolveWidgetSlot` trusts `source_board_id` for
    // chart/list kinds too, but the aggregate family (number/battery/
    // completion/health) resolves on the SERVICE client (queries-cached.ts),
    // which bypasses RLS entirely. Without this precheck, an org member could
    // read aggregated counts over a board they cannot open. A null board read
    // returns the same not-found shape as a missing widget, so the tool never
    // discloses whether the board exists vs. is merely unreadable.
    if (widget.source_board_id) {
      const { data: board, error: boardErr } = await supabase
        .from("boards")
        .select("id")
        .eq("id", widget.source_board_id)
        .maybeSingle();
      if (boardErr)
        throw new Error(`Failed to load board: ${boardErr.message}`);
      if (!board)
        return {
          content: [
            { type: "text", text: `Widget ${args.widgetId} not found.` },
          ],
          isError: true,
        };
    }

    const slot = await resolveWidgetSlot(supabase, args.widgetId, widget);
    if (!slot.ok)
      return { content: [{ type: "text", text: slot.error }], isError: true };

    const { ok: _ok, ...payload } = slot;
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerGetWidgetDataTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_widget_data",
    {
      title: "Get widget data",
      description:
        "Resolve one dashboard widget's data — a chart's series, a list widget's rows, or an aggregate number. Row and series counts are bounded by the widget's own configuration. Get ids from get_dashboard.",
      inputSchema: { widgetId: z.string().uuid() },
    },
    async (args) => getWidgetDataHandler(getClient, args),
  );
}
