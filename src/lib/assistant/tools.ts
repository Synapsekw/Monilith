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
import { takesOrgId } from "./org-pin";
import { MAX_STAGED_CALLS, stagedCallSchema, type StagedCall } from "./staged";

const OPAQUE_FAILURE = "Tool failed.";
export const ORG_MISMATCH_ERROR =
  "That organization is not the one you are working in.";
export const STAGE_INVALID_ERROR =
  "This change could not be lined up. Nothing was staged.";

/** The one failure shape the model sees. The preamble names this field. */
function failure(message: string): { error: string } {
  return { error: message };
}

/**
 * Pin an org-scoped call to the active org. The catalog was written for a
 * user-level MCP connection, where an omitted `orgId` means "the user's first
 * org by name". Here it must mean the org the user is working in, so it is
 * filled in before the call is classified, run or staged; a different org is
 * refused. Returns null for a refusal.
 *
 * Known residual: calls addressed by board, item, group, column, view or
 * automation id are not org-checked here beyond RLS (tracked for Plan B).
 */
function pinToOrg(
  d: ToolDescriptor,
  input: Record<string, unknown>,
  orgId: string,
): Record<string, unknown> | null {
  if (!takesOrgId(d)) return input;
  if (input.orgId === undefined || input.orgId === null)
    return { ...input, orgId };
  return input.orgId === orgId ? input : null;
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
  /** The active org. Every org-scoped call is pinned to it. */
  orgId: string;
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
        execute: async (raw: Record<string, unknown>) => {
          const input = pinToOrg(d, raw, args.orgId);
          if (input === null) return failure(ORG_MISMATCH_ERROR);
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
            // `?? null`: an action named after a prototype key ("constructor")
            // makes the scope lookup fall through and return undefined.
            boardId =
              (await resolveTargetBoardId(args.client, d, input)) ?? null;
          } catch {
            // Apply re-checks everything under RLS; a failed lookup here only
            // costs the board refresh after Apply.
            boardId = null;
          }
          // The provider's tool call id is not used: an empty, over-long or
          // repeated one would make the stored trace fail to parse on reload,
          // or make two rows tick together. Validated here so what is stored
          // is exactly what `parseToolTrace` will accept back.
          const parsed = stagedCallSchema.safeParse({
            id: crypto.randomUUID(),
            tool: d.name,
            input,
            summary: summariseProposal(d.name, input),
            destructive: effect === "destructive",
            boardId,
          } satisfies StagedCall);
          if (!parsed.success) return failure(STAGE_INVALID_ERROR);
          const call = parsed.data;
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
