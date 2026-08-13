import "server-only";
import { z } from "zod";
import { tool, type ToolSet } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type {
  ToolDescriptor,
  ToolInvokeContext,
} from "@/lib/mcp/tools/descriptor";
import type { BoardScope } from "./agent-config";
import { isBoardInScope, resolveTargetBoardId } from "./board-scope-guard";
import { descriptorsFor } from "./tool-descriptors";

/** What the model is told when a call names a board outside this agent's
 *  configured scope. A refusal it can act on — pick another board — not a
 *  crash. */
export const OUT_OF_SCOPE_ERROR =
  "That board is outside this agent's configured scope.";

/** What the model is told when a handler throws something that is not an
 *  `Error` and therefore carries no message worth forwarding. */
const OPAQUE_FAILURE = "Tool failed.";

/**
 * THE ONE FAILURE SHAPE. Every way a tool call can fail — out of scope, a
 * handler that THREW, and a handler that returned `isError: true` — reaches the
 * model as `{ error: string }` and nothing else.
 *
 * It is a function rather than three inline object literals because the three
 * paths previously disagreed: a thrown handler produced `{ error }` while an
 * `isError` handler had its text joined by the success path and arrived as an
 * ordinary success STRING ("Board not found."), indistinguishable from a
 * successful read. The model then reported the failure as a completed action.
 * Same failure class, one shape — and the system prompt in `run-loop.ts` names
 * this field explicitly, so the two must not drift.
 */
function toolFailure(message: string): { error: string } {
  return { error: message };
}

/**
 * The AI SDK tool set a personal agent runs with.
 *
 * Built from `descriptorsFor()` — which starts from `ALL_TOOL_DESCRIPTORS`, the
 * SAME definitions the MCP server registers, so a tool can never be reachable
 * over one transport and stale on the other, and which `makeGrantGate` reads
 * too so the set and the gate cannot disagree.
 * `create_attachment_upload` is the one catalog exclusion: it hands back a
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
   *  wrapper, same guard, same classification — pass the IDENTICAL array to
   *  `makeGrantGate`, or the gate will not recognise these tools. Reusing a
   *  catalog name throws (`DuplicateToolNameError`). */
  extra?: readonly ToolDescriptor[];
}): ToolSet {
  const descriptors = descriptorsFor({ extra: args.extra });

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
            return toolFailure(OUT_OF_SCOPE_ERROR);
          }
          try {
            const r = await d.invoke(args.ctx, input);
            const text = r.content.map((c) => c.text).join("\n");
            // A descriptor's OWN refusal (`isError: true` — "Board not found.",
            // "That document is 200000 bytes…") is a failure, not a result. It
            // must not reach the model as an ordinary success string: the model
            // would report the action as done. Same shape as the thrown path.
            return r.isError ? toolFailure(text || OPAQUE_FAILURE) : text;
          } catch (e) {
            // A handler that throws (transient DB error, an RLS refusal
            // surfacing as an exception) must NOT abort the run — this is an
            // unattended 07:00 job. Hand the message back as a tool result and
            // let the model adapt.
            return toolFailure(e instanceof Error ? e.message : OPAQUE_FAILURE);
          }
        },
      }),
    ]),
  );
}
