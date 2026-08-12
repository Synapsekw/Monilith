import "server-only";
import { z } from "zod";
import { tool, type ToolSet } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";
import type {
  ToolDescriptor,
  ToolInvokeContext,
} from "@/lib/mcp/tools/descriptor";
import type { BoardScope } from "./agent-config";
import { isBoardInScope, resolveTargetBoardId } from "./board-scope-guard";

/** What the model is told when a call names a board outside this agent's
 *  configured scope. A refusal it can act on — pick another board — not a
 *  crash. */
export const OUT_OF_SCOPE_ERROR =
  "That board is outside this agent's configured scope.";

/** What the model is told when a handler throws something that is not an
 *  `Error` and therefore carries no message worth forwarding. */
const OPAQUE_FAILURE = "Tool failed.";

/**
 * The AI SDK tool set a personal agent runs with.
 *
 * Built from `ALL_TOOL_DESCRIPTORS` — the SAME definitions the MCP server
 * registers — so a tool can never be reachable over one transport and stale on
 * the other. `create_attachment_upload` is the one exclusion: it hands back a
 * signed URL the caller must PUT bytes to, which a model inside a tool loop
 * cannot do (`agentExcluded`).
 *
 * EVERY tool is included regardless of what the agent has been granted. That is
 * deliberate and is the crux of the design: `activeTools` is NOT the
 * enforcement mechanism. A model that cannot see `attach_file` can never
 * propose it, and the propose-then-approve path is the entire point. Grants are
 * enforced in `makeGrantGate` (`grant-gate.ts`), by denying a call the model
 * was free to make.
 *
 * Board scope IS enforced here, in the wrapper, before the handler runs —
 * asking the model nicely in the system prompt is not enforcement. It narrows;
 * it never widens, because `args.client` and `args.ctx.getClient` are both
 * authenticated as the agent's OWNER and RLS refuses anything they may not see.
 */
export function buildAgentTools(args: {
  ctx: ToolInvokeContext;
  scope: BoardScope;
  /** The OWNER's client, used only to resolve an id to its board. Never a
   *  service client: a resolution must not reveal a board the owner cannot
   *  see. */
  client: SupabaseClient<Database>;
  /** Descriptors outside the MCP catalog (Task 7's run-local tools). Same
   *  wrapper, same guard — a later entry wins on a name collision. */
  extra?: ToolDescriptor[];
}): ToolSet {
  const descriptors = [...ALL_TOOL_DESCRIPTORS, ...(args.extra ?? [])].filter(
    (d) => !d.agentExcluded,
  );

  return Object.fromEntries(
    descriptors.map((d) => [
      d.name,
      tool({
        description: d.description,
        // Descriptors carry MCP's raw shape; the AI SDK wants a schema.
        inputSchema: z.object(d.inputSchema),
        execute: async (input: Record<string, unknown>) => {
          const boardId = await resolveTargetBoardId(args.client, d, input);
          if (!isBoardInScope(args.scope, boardId)) {
            return { error: OUT_OF_SCOPE_ERROR };
          }
          try {
            const r = await d.invoke(args.ctx, input);
            return r.content.map((c) => c.text).join("\n");
          } catch (e) {
            // A handler that throws (transient DB error, an RLS refusal
            // surfacing as an exception) must NOT abort the run — this is an
            // unattended 07:00 job. Hand the message back as a tool result and
            // let the model adapt.
            return { error: e instanceof Error ? e.message : OPAQUE_FAILURE };
          }
        },
      }),
    ]),
  );
}
