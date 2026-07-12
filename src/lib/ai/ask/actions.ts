"use server";
import { z } from "zod";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { askPulseLoop } from "@/lib/ai/ask/ask";
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

const askSchema = z.object({
  // Bounded free text: it flows verbatim into the Anthropic prompt, so an
  // unbounded string is a token/cost-abuse vector.
  question: z.string().trim().min(3).max(1000),
});

/**
 * Answer a natural-language question about the caller's boards via the Ask
 * Pulse tool-use loop. Entitlement-gated before any token spend; the workspace
 * is resolved server-side (never trusted from the client). Requires an
 * Anthropic key — only that provider supports tool use.
 */
export async function askPulse(input: {
  question: string;
}): Promise<ActionResult<{ answer: string; boardsConsulted: string[] }>> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success)
    return fail("Ask a question between 3 and 1000 characters.");
  const { question } = parsed.data;

  try {
    const user = await requireUser();
    const org = (await getUserOrgs())[0];
    if (!org) return fail("No organization.");

    await requireAiEntitlement(org.id, "ask_pulse");

    const workspaces = await listWorkspacesCached(org.id);
    const workspaceId = await getActiveWorkspaceId(workspaces);
    if (!workspaceId) return fail("No workspace.");

    const result = await runAi(
      { orgId: org.id, userId: user.id, feature: "ask_pulse" },
      async ({ adapter, apiKey }) => {
        if (!adapter.supportsTools)
          throw new ProviderNotCapableError("ask_pulse");
        const r = await askPulseLoop({ apiKey, workspaceId, question });
        return { result: r, usage: r.usage, model: MODEL };
      },
    );

    return {
      ok: true,
      data: { answer: result.answer, boardsConsulted: result.boardsConsulted },
    };
  } catch (e) {
    if (e instanceof ProviderNotCapableError)
      return fail(
        "Ask Pulse needs an Anthropic key — dashboards work with any provider.",
      );
    if (e instanceof AiDisabledError)
      return fail("AI is turned off for your organization.");
    if (e instanceof AiQuotaExceededError)
      return fail("You've used this month's AI allowance.");
    if (e instanceof AiNotConfiguredError)
      return fail("Add an AI provider key in Settings to use Ask Pulse.");
    if (e instanceof ByoKeyMissingError)
      return fail(
        "Your organization's AI key is missing — ask an admin to update Settings.",
      );
    return fail("Ask Pulse hit a snag. Please try again.");
  }
}
