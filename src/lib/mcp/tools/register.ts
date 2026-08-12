import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { getRequestClient, mcpActorId } from "@/lib/mcp/context";
import { registerDescriptor, type ToolDescriptor } from "./descriptor";
import { listBoardsDescriptor } from "./list-boards";
import { getBoardDescriptor } from "./get-board";
import { listItemsDescriptor } from "./list-items";
import { searchItemsDescriptor } from "./search-items";
import { getItemDescriptor } from "./get-item";
import { createItemDescriptor } from "./create-item";
import { updateItemDescriptor } from "./update-item";
import { createAttachmentUploadDescriptor } from "./create-attachment-upload";
import { attachFileDescriptor } from "./attach-file";
import { listOrganizationsDescriptor } from "./list-organizations";
import { getMyWorkDescriptor } from "./get-my-work";
import { listTimeAllocationsDescriptor } from "./list-time-allocations";
import { getTimeSummaryDescriptor } from "./get-time-summary";
import { logTimeAllocationDescriptor } from "./log-time-allocation";
import { listGoalsDescriptor } from "./list-goals";
import { getGoalDescriptor } from "./get-goal";
import { listPortfoliosDescriptor } from "./list-portfolios";
import { getPortfolioDescriptor } from "./get-portfolio";
import { listDashboardsDescriptor } from "./list-dashboards";
import { getDashboardDescriptor } from "./get-dashboard";
import { getWidgetDataDescriptor } from "./get-widget-data";
import { getWorkloadDescriptor } from "./get-workload";
import { listReportsDescriptor } from "./list-reports";
import { getReportDescriptor } from "./get-report";

/** Registration order is preserved from the previous hand-written sequence so
 *  the MCP tool listing a connected client sees does not reorder. */
export const ALL_TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  listBoardsDescriptor,
  getBoardDescriptor,
  listItemsDescriptor,
  searchItemsDescriptor,
  getItemDescriptor,
  createItemDescriptor,
  updateItemDescriptor,
  createAttachmentUploadDescriptor,
  attachFileDescriptor,
  listOrganizationsDescriptor,
  getMyWorkDescriptor,
  listTimeAllocationsDescriptor,
  getTimeSummaryDescriptor,
  logTimeAllocationDescriptor,
  listGoalsDescriptor,
  getGoalDescriptor,
  listPortfoliosDescriptor,
  getPortfolioDescriptor,
  listDashboardsDescriptor,
  getDashboardDescriptor,
  getWidgetDataDescriptor,
  getWorkloadDescriptor,
  listReportsDescriptor,
  getReportDescriptor,
];

/** Registers every MCP tool onto the server instance, closing over the request's auth. */
export function registerTools(server: McpServer, auth: AuthInfo): void {
  const ctx = {
    getClient: () => getRequestClient(auth),
    actorId: mcpActorId(auth),
  };
  for (const d of ALL_TOOL_DESCRIPTORS) registerDescriptor(server, d, ctx);
}
