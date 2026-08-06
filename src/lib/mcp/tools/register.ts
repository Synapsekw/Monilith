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
}
