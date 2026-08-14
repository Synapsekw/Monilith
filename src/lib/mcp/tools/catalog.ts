import type { ToolDescriptor } from "./descriptor";
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

/**
 * Every MCP tool's descriptor, deliberately kept OUT of `register.ts`:
 * `register.ts` imports `@/lib/mcp/context`, whose first line is
 * `import "server-only"`, which would taint this list for any client
 * component that needs it (the consent table today; the client-side agent
 * editor in Task 8). This module imports nothing server-only, so it is safe
 * for both server and client consumers.
 */

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
