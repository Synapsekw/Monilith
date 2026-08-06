import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listDashboardsCore,
  DASHBOARD_LIST_LIMIT,
} from "@/lib/dashboards/queries";
import { resolveOrgForTool } from "@/lib/mcp/org-scope";
import type { GetClient, ToolResult } from "./shared";

export async function listDashboardsHandler(
  getClient: GetClient,
  args: { orgId?: string },
): Promise<ToolResult> {
  const supabase = await getClient();
  const scope = await resolveOrgForTool(supabase, args.orgId);
  if ("error" in scope)
    return { content: [{ type: "text", text: scope.error }], isError: true };

  try {
    const dashboards = await listDashboardsCore(supabase, scope.org.id);
    return { content: [{ type: "text", text: JSON.stringify(dashboards) }] };
  } catch (e) {
    return {
      content: [{ type: "text", text: (e as Error).message }],
      isError: true,
    };
  }
}

export function registerListDashboardsTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "list_dashboards",
    {
      title: "List dashboards",
      description: `Dashboards visible to the connected user in one organization. Returns at most ${DASHBOARD_LIST_LIMIT}.`,
      inputSchema: { orgId: z.string().uuid().optional() },
    },
    async (args) => listDashboardsHandler(getClient, args),
  );
}
