import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetClient, ToolResult } from "./shared";
import type { AgentCapability } from "@/lib/agents/capabilities";

/**
 * The single definition of a tool, consumed by BOTH transports: the MCP server
 * (`registerDescriptor` below) and the in-app agent runtime
 * (`src/lib/agents/tools.ts`). Two transports over one definition is the whole
 * point — a tool cannot be reachable from one and stale in the other.
 */

/**
 * How this tool's target board is derived, for `board_scope` enforcement. The
 * field name on the input matches the value: a `"boardId"` tool has a
 * `boardId` input, and so on. `"none"` means the call addresses no single
 * board (`list_boards`, `get_my_work`, org/goal/portfolio reads).
 */
export const TOOL_SCOPES = ["none", "boardId", "itemId", "groupId"] as const;
export type ToolScope = (typeof TOOL_SCOPES)[number];

export type ToolInvokeContext = { getClient: GetClient; actorId: string };

export type ToolDescriptor = {
  name: string;
  title: string;
  description: string;
  /** MCP's raw-shape form. The agent side wraps it with `z.object(...)`. */
  inputSchema: z.ZodRawShape;
  /** `null` means an always-on read. The vocabulary lives in
   *  `@/lib/agents/capabilities` — one declaration, imported by both the
   *  descriptor layer and the agent editor. */
  capability: AgentCapability | null;
  scope: ToolScope;
  /** Served over MCP but never offered to an agent. See create-attachment-upload. */
  agentExcluded?: true;
  /**
   * `input` is typed loosely because both transports validate against
   * `inputSchema` BEFORE calling: the MCP SDK does it during dispatch, and the
   * AI SDK does it in `tool()`. Each descriptor therefore casts once, at the
   * boundary, to the shape its own handler declares — the single narrow cast
   * this indirection costs.
   */
  invoke: (
    ctx: ToolInvokeContext,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
};

/** Registers one descriptor on the MCP server. Metadata must stay byte-identical
 *  to what the old per-tool `register…Tool` helpers passed — `mcp-tools-table.test.tsx`
 *  is the guard. */
export function registerDescriptor(
  server: McpServer,
  d: ToolDescriptor,
  ctx: ToolInvokeContext,
): void {
  server.registerTool(
    d.name,
    { title: d.title, description: d.description, inputSchema: d.inputSchema },
    async (input: Record<string, unknown>) => d.invoke(ctx, input),
  );
}
