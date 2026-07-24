import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRequestClient } from "@/lib/mcp/context";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { registerListBoardsTool } from "./list-boards";
import { registerGetBoardTool } from "./get-board";
import { registerSearchItemsTool } from "./search-items";
import { registerGetItemTool } from "./get-item";

/** Registers every MCP tool onto the server instance, closing over the request's auth. */
export function registerTools(server: McpServer, auth: AuthInfo): void {
  const getClient = () => getRequestClient(auth);
  registerListBoardsTool(server, getClient);
  registerGetBoardTool(server, getClient);
  registerSearchItemsTool(server, getClient);
  registerGetItemTool(server, getClient);
}
