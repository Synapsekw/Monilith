import "server-only";
import { z } from "zod";
import { tool, type ToolSet } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type {
  ToolDescriptor,
  ToolInvokeContext,
} from "@/lib/mcp/tools/descriptor";
import { resolveTargetBoardId } from "@/lib/agents/board-scope-guard";
import { summariseProposal } from "@/lib/agents/proposal-summary";
import { assistantDescriptors, effectOf } from "./catalog";
import { MAX_STAGED_CALLS, type StagedCall } from "./staged";

const OPAQUE_FAILURE = "Tool failed.";

/** The one failure shape the model sees. The preamble names this field. */
function failure(message: string): { error: string } {
  return { error: message };
}

/**
 * The assistant's tool set. A read runs now, under the user's own client, so
 * RLS decides what it can see. A write is never run here: it is described,
 * handed to `stage`, and reported to the model as waiting for confirmation.
 */
export function buildAssistantTools(args: {
  ctx: ToolInvokeContext;
  /** The user's client. Used only to find which board a staged call addresses. */
  client: SupabaseClient<Database>;
  /** Records one staged call. Returns false when the batch is full. */
  stage: (call: StagedCall) => boolean;
  /** Test seam. Defaults to the real catalog. */
  descriptors?: readonly ToolDescriptor[];
}): ToolSet {
  const descriptors = args.descriptors ?? assistantDescriptors();
  return Object.fromEntries(
    descriptors.map((d) => [
      d.name,
      tool({
        description: d.description,
        inputSchema: z.object(d.inputSchema),
        execute: async (
          input: Record<string, unknown>,
          options: { toolCallId: string },
        ) => {
          const effect = effectOf(d, input);
          if (effect === "read") {
            try {
              const r = await d.invoke(args.ctx, input);
              const text = r.content.map((c) => c.text).join("\n");
              return r.isError ? failure(text || OPAQUE_FAILURE) : text;
            } catch (e) {
              return failure(e instanceof Error ? e.message : OPAQUE_FAILURE);
            }
          }
          let boardId: string | null = null;
          try {
            boardId = await resolveTargetBoardId(args.client, d, input);
          } catch {
            // Apply re-checks everything under RLS; a failed lookup here only
            // costs the board refresh after Apply.
            boardId = null;
          }
          const call: StagedCall = {
            id: options.toolCallId,
            tool: d.name,
            input,
            summary: summariseProposal(d.name, input),
            destructive: effect === "destructive",
            boardId,
          };
          if (!args.stage(call))
            return failure(
              `This turn already has ${MAX_STAGED_CALLS} staged changes, the most one confirmation can hold. Stop staging and tell the user.`,
            );
          return {
            staged: true,
            summary: call.summary,
            note: "Not applied. Waiting for the user to confirm.",
          };
        },
      }),
    ]),
  );
}
