import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMyWorkItemsCore } from "@/lib/my-work/queries";
import { bucketMyWork } from "@/lib/my-work/bucket";
import { serverToday } from "@/lib/portfolios/rollup";
import type { GetClient, ToolResult } from "./shared";

/** Tool-side cap — well under MY_WORK_ITEM_LIMIT (500), which sizes a scrollable
 *  page. An agent reading 200 assigned items already has more than it can use. */
export const MY_WORK_TOOL_LIMIT = 200;

export async function getMyWorkHandler(
  getClient: GetClient,
): Promise<ToolResult> {
  const supabase = await getClient();
  const items = await getMyWorkItemsCore(supabase, MY_WORK_TOOL_LIMIT);
  const today = serverToday(Date.now());

  // Projection drops status.color — a UI token with no meaning to an agent.
  const groups = bucketMyWork(items, today).map((g) => ({
    bucket: g.bucket,
    label: g.label,
    items: g.items.map((i) => ({
      id: i.itemId,
      name: i.itemName,
      boardId: i.boardId,
      boardName: i.boardName,
      groupName: i.groupName,
      dueDate: i.dueDate,
      status: i.status?.label ?? null,
    })),
  }));

  return {
    content: [{ type: "text", text: JSON.stringify({ today, groups }) }],
  };
}

export function registerGetMyWorkTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "get_my_work",
    {
      title: "Get my work",
      description: `Every item assigned to the connected user across all boards, grouped by due date (overdue, today, this week, later, no date). Returns at most ${MY_WORK_TOOL_LIMIT} items. Scoped to the user automatically — no organization argument.`,
      inputSchema: {},
    },
    async () => getMyWorkHandler(getClient),
  );
}
