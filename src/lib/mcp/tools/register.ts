import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { getRequestClient, mcpActorId } from "@/lib/mcp/context";
import { registerDescriptor } from "./descriptor";
import { ALL_TOOL_DESCRIPTORS } from "./catalog";

/** Registers every MCP tool onto the server instance, closing over the request's auth. */
export function registerTools(server: McpServer, auth: AuthInfo): void {
  const ctx = {
    getClient: () => getRequestClient(auth),
    actorId: mcpActorId(auth),
  };
  for (const d of ALL_TOOL_DESCRIPTORS) registerDescriptor(server, d, ctx);
}
