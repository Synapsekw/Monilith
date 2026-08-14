import { z } from "zod";
import { getDashboardPayloadCore } from "@/lib/dashboards/queries";
import type { GetClient, ToolResult } from "./shared";
import type { ToolDescriptor } from "./descriptor";

export async function getDashboardHandler(
  getClient: GetClient,
  args: { dashboardId: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  try {
    const payload = await getDashboardPayloadCore(supabase, args.dashboardId);
    if (!payload)
      return {
        content: [
          { type: "text", text: `Dashboard ${args.dashboardId} not found.` },
        ],
        isError: true,
      };

    // Descriptors only. Resolving each widget's data is a separate, explicit
    // get_widget_data call — listing a dashboard never fires N aggregations.
    // Layout (x/y/w/h) and palette are dropped: canvas geometry, not meaning.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: payload.dashboard.id,
            name: payload.dashboard.name,
            widgets: payload.widgets.map((w) => ({
              widgetId: w.id,
              title: w.title,
              kind: w.kind,
              boardId: w.source_board_id,
            })),
          }),
        },
      ],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export const getDashboardDescriptor: ToolDescriptor = {
  name: "get_dashboard",
  title: "Get dashboard",
  description:
    "One dashboard's widgets as descriptors (id, title, kind, source board) — no data. Call get_widget_data with a widgetId to resolve one widget's numbers.",
  inputSchema: { dashboardId: z.string().uuid() },
  capability: null,
  scope: "none",
  invoke: (ctx, input) =>
    getDashboardHandler(ctx.getClient, input as { dashboardId: string }),
};
