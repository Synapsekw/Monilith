import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
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
 * board — either it takes no board-shaped input at all (`list_boards`,
 * `get_my_work`), or it reaches board data through an id of another kind
 * (`get_report` by `reportId`, `get_dashboard` by `dashboardId`,
 * `get_portfolio` by `portfolioId`, `get_widget_data` by `widgetId`).
 *
 * THE LIMIT THIS IMPLIES, stated plainly: `board_scope` narrows board-ADDRESSED
 * reads only. For the `"none"` tools RLS is the sole boundary — it already
 * stops cross-org and unshared-board access, but it does NOT honour an agent's
 * "limit to these boards" preference. Resolving a portfolio or dashboard to a
 * board set was rejected deliberately: they span many boards, so "in scope"
 * becomes an all-or-any question this design does not answer. The agent
 * editor's board-scope help text must therefore not overpromise (Task 8).
 */
export const TOOL_SCOPES = [
  "none",
  "boardId",
  "itemId",
  "groupId",
  "columnId",
  "viewId",
  "automationId",
] as const;
export type ToolScope = (typeof TOOL_SCOPES)[number];

export type ToolInvokeContext = { getClient: GetClient; actorId: string };

export type ToolDescriptor = {
  name: string;
  title: string;
  description: string;
  /** MCP's raw-shape form. The agent side wraps it with `z.object(...)`.
   *  Spelled as `Record<string, z.ZodType>` rather than `z.ZodRawShape`
   *  because that is the shape `registerTool` accepts: zod 4's own
   *  `ZodRawShape` is the looser `Readonly<Record<string, $ZodType>>`, which
   *  the MCP server SDK rejects. */
  inputSchema: Record<string, z.ZodType>;
  /** `null` means an always-on read. The vocabulary lives in
   *  `@/lib/agents/capabilities` — one declaration, imported by both the
   *  descriptor layer and the agent editor.
   *  A scalar for a single-purpose tool; a per-action map for a
   *  grouped-dispatch tool, keyed by the `action` input value. */
  capability: AgentCapability | null | Record<string, AgentCapability | null>;
  scope: ToolScope | Record<string, ToolScope>;
  /** Actions that create a new top-level object, addressing no existing board.
   *  Refused when the agent's board_scope is narrowed — see `buildAgentTools`. */
  unscopedCreateActions?: readonly string[];
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

/** The most restrictive capability in a map — the fail-closed answer for an
 *  action the map does not name. `board.destroy` outranks `board.structure`
 *  outranks everything else; a map with no non-null value yields the tool's
 *  most restrictive stated grant, never `null`. */
function mostRestrictive(
  map: Record<string, AgentCapability | null>,
): AgentCapability {
  const values = Object.values(map).filter(
    (v): v is AgentCapability => v !== null,
  );
  // An empty or all-null map is a DECLARATION BUG, not a read. Fail closed to
  // the most restrictive grant an owner can withhold, so an action nobody
  // named is denied rather than executed ungated.
  if (values.length === 0) return "board.destroy";
  if (values.includes("board.destroy")) return "board.destroy";
  if (values.includes("board.structure")) return "board.structure";
  return values[0]!;
}

/**
 * The capability ONE call costs.
 *
 * Every consumer must route through this rather than reading `d.capability`:
 * a grouped-dispatch tool's cost depends on its `action`, and a consumer that
 * reads the field directly sees a `Record` where it expected a string.
 *
 * FAILS CLOSED. An action absent from the map cannot occur — the discriminated
 * union in the handler rejects it first — but this must not depend on that.
 * Returning `null` for an unknown action would classify it as a
 * capability-free read and let it execute ungated, which is exactly the
 * shadowing bug `descriptorsFor` exists to prevent, arriving by another route.
 */
export function capabilityFor(
  d: ToolDescriptor,
  input: Record<string, unknown>,
): AgentCapability | null {
  if (d.capability === null || typeof d.capability === "string")
    return d.capability;
  const action = input.action;
  if (typeof action === "string" && action in d.capability)
    return d.capability[action]!;
  return mostRestrictive(d.capability);
}

/**
 * Which id names the board this call addresses.
 *
 * `"none"` is the fallback rather than a guess: it means board scope has
 * nothing to say about the call, leaving RLS as the boundary — which is the
 * honest answer for an action nobody declared, and is what `resolveTargetBoardId`
 * already does for genuinely board-less tools.
 */
export function scopeFor(
  d: ToolDescriptor,
  input: Record<string, unknown>,
): ToolScope {
  if (typeof d.scope === "string") return d.scope;
  const action = input.action;
  if (typeof action === "string" && action in d.scope) return d.scope[action]!;
  return "none";
}

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
