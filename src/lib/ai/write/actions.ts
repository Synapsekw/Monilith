"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement, getAiEntitlement } from "@/lib/ai/entitlement";
import { proposeLoop } from "./propose";
import { executeAction } from "./execute";
// Type-only: this is a `"use server"` module, where a non-async export fails
// only at `pnpm build`. BoardEffect lives in a plain module both sides import.
import type { BoardEffect } from "./effects";
import {
  validatedActionSchema,
  aiConversationHistorySchema,
  type ValidatedAction,
  type ExecutionResult,
  type AiConversationTurn,
} from "./schema";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  AiNotConfiguredError,
  ProviderNotCapableError,
} from "@/lib/ai/errors";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { fail, type ActionResult } from "@/lib/actions/result";

const instructionSchema = z.object({
  instruction: z.string().trim().min(3).max(1000),
});

/** Hard cap on threaded user replies — bounds cost/latency of a clarification. */
const MAX_TURNS = 5;

/** Map a typed AI error to friendly copy, or null if it's not one we recognize. */
function mapAiError(e: unknown): string | null {
  if (e instanceof ProviderNotCapableError)
    return "Conversational actions need an Anthropic key.";
  if (e instanceof AiDisabledError)
    return "AI is turned off for your organization.";
  if (e instanceof AiQuotaExceededError)
    return "You've used this month's AI allowance.";
  if (e instanceof AiNotConfiguredError)
    return "Add an AI provider key in Settings to use this.";
  if (e instanceof ByoKeyMissingError)
    return "Your organization's AI key is missing — ask an admin to update Settings.";
  return null;
}

/**
 * Turn a natural-language command into PROPOSED, human-confirmable board writes.
 * Entitlement-gated before any token spend; org/workspace resolved server-side.
 * The model only emits proposals — nothing is written here.
 */
export async function proposeActions(input: {
  instruction: string;
  history?: unknown;
}): Promise<
  ActionResult<{
    actions: ValidatedAction[];
    clarification?: string;
    history: AiConversationTurn[];
  }>
> {
  const parsed = instructionSchema.safeParse(input);
  if (!parsed.success) return fail("Describe the action in 3–1000 characters.");

  // Continue a prior clarification when the client threads a transcript back.
  // Malformed history degrades to a fresh start — a dead-end is the UX we're
  // removing — but a well-formed transcript past the turn cap is refused.
  const histParsed = aiConversationHistorySchema.safeParse(input.history ?? []);
  const history = (
    histParsed.success ? histParsed.data : []
  ) as AiConversationTurn[];
  const userTurns = history.filter((m) => m.role === "user").length;
  if (userTurns >= MAX_TURNS)
    return fail("Let's start fresh — try a more specific command.");

  try {
    const user = await requireUser();
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    await requireAiEntitlement(org.id, "conversational_action");
    const workspaceId = await getActiveWorkspaceId(
      await listWorkspacesCached(org.id),
    );
    if (!workspaceId) return fail("No workspace.");

    const result = await runAi(
      { orgId: org.id, userId: user.id, feature: "conversational_action" },
      async ({ adapter, apiKey }) => {
        if (!adapter.supportsTools)
          throw new ProviderNotCapableError("conversational_action");
        const r = await proposeLoop({
          apiKey,
          orgId: org.id,
          workspaceId,
          instruction: parsed.data.instruction,
          messages: history.length ? history : undefined,
        });
        return { result: r, usage: r.usage, model: r.model };
      },
    );
    return {
      ok: true,
      data: {
        actions: result.actions,
        clarification: result.clarification,
        history: result.messages,
      },
    };
  } catch (e) {
    const msg = mapAiError(e);
    if (msg) return fail(msg);
    return fail("Couldn't work out that action. Please try again.");
  }
}

/**
 * Execute human-approved actions. Re-validates every action against
 * `ValidatedAction` server-side (never trusts the client array) and re-checks
 * the org can still use AI, then runs each via the canonical Server Actions.
 * No new entitlement charge — execution is deterministic DB work, not a model call.
 */
export async function executeActions(input: {
  actions: unknown[];
}): Promise<
  ActionResult<{ results: ExecutionResult[]; effects: BoardEffect[] }>
> {
  const parsed = z
    .array(validatedActionSchema)
    .min(1)
    .max(10)
    .safeParse(input.actions);
  if (!parsed.success) return fail("Nothing valid to apply.");

  try {
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    // Re-check the org can still use AI (a disabled org shouldn't execute a stale proposal).
    const ent = await getAiEntitlement(org.id);
    if (ent.mode === "off")
      return fail("AI is turned off for your organization.");

    // `results` is what the thread records; `effects` are the rows the writes
    // produced, handed straight back so the acting client can render its own
    // change with NO extra round-trip. Bounded by the ≤10 action cap above.
    const results: ExecutionResult[] = [];
    const effects: BoardEffect[] = [];
    for (const action of parsed.data) {
      const { result, effect } = await executeAction(action);
      results.push(result);
      if (effect) effects.push(effect);
    }
    return { ok: true, data: { results, effects } };
  } catch {
    return fail("Couldn't apply that action. Please try again.");
  }
}
