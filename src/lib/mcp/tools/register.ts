import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRequestClient, mcpActorId } from "@/lib/mcp/context";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { registerListBoardsTool } from "./list-boards";
import { registerGetBoardTool } from "./get-board";
import { registerListItemsTool } from "./list-items";
import { registerSearchItemsTool } from "./search-items";
import { registerGetItemTool } from "./get-item";
import { registerCreateItemTool } from "./create-item";
import { registerUpdateItemTool } from "./update-item";
import { registerListOrganizationsTool } from "./list-organizations";
import { registerGetMyWorkTool } from "./get-my-work";
import { registerListTimeAllocationsTool } from "./list-time-allocations";
import { registerGetTimeSummaryTool } from "./get-time-summary";
import { registerLogTimeAllocationTool } from "./log-time-allocation";
import { registerListGoalsTool } from "./list-goals";
import { registerGetGoalTool } from "./get-goal";
import { registerListPortfoliosTool } from "./list-portfolios";
import { registerGetPortfolioTool } from "./get-portfolio";
import { registerListDashboardsTool } from "./list-dashboards";
import { registerGetDashboardTool } from "./get-dashboard";
import { registerGetWidgetDataTool } from "./get-widget-data";
import { registerGetWorkloadTool } from "./get-workload";
import { registerListReportsTool } from "./list-reports";
import { registerGetReportTool } from "./get-report";

/** Registers every MCP tool onto the server instance, closing over the request's auth. */
export function registerTools(server: McpServer, auth: AuthInfo): void {
  const getClient = () => getRequestClient(auth);
  const actorId = mcpActorId(auth);
  registerListBoardsTool(server, getClient);
  registerGetBoardTool(server, getClient);
  registerListItemsTool(server, getClient);
  registerSearchItemsTool(server, getClient);
  registerGetItemTool(server, getClient);
  registerCreateItemTool(server, getClient, actorId);
  registerUpdateItemTool(server, getClient, actorId);
  registerListOrganizationsTool(server, getClient);
  registerGetMyWorkTool(server, getClient);
  registerListTimeAllocationsTool(server, getClient, actorId);
  registerGetTimeSummaryTool(server, getClient, actorId);
  registerLogTimeAllocationTool(server, getClient, actorId);
  registerListGoalsTool(server, getClient);
  registerGetGoalTool(server, getClient);
  registerListPortfoliosTool(server, getClient);
  registerGetPortfolioTool(server, getClient);
  registerListDashboardsTool(server, getClient);
  registerGetDashboardTool(server, getClient);
  registerGetWidgetDataTool(server, getClient);
  registerGetWorkloadTool(server, getClient);
  registerListReportsTool(server, getClient);
  registerGetReportTool(server, getClient);
}

/**
 * Every tool name `registerTools` registers, in registration order.
 *
 * The settings table (`src/components/settings/mcp/mcp-tools-table.tsx`) is
 * checked against this list by test, so a tool added above without a row there
 * fails CI. That table is the user's only account of what they are granting;
 * an understated list is a consent bug, not a docs bug.
 */
export const MCP_TOOL_NAMES = [
  "list_boards",
  "get_board",
  "list_items",
  "search_items",
  "get_item",
  "create_item",
  "update_item",
  "list_organizations",
  "get_my_work",
  "list_time_allocations",
  "get_time_summary",
  "log_time_allocation",
  "list_goals",
  "get_goal",
  "list_portfolios",
  "get_portfolio",
  "list_dashboards",
  "get_dashboard",
  "get_widget_data",
  "get_workload",
  "list_reports",
  "get_report",
] as const;
