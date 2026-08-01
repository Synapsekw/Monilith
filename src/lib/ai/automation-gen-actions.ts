"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { runAi } from "@/lib/ai/gateway";
import { modelFor } from "@/lib/ai/model-map";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { buildAutomationContext } from "@/lib/ai/automation-context";
import { validateAutomationDraft } from "@/lib/ai/automation-gen-schema";
import { generateAutomationDraft as generateAutomationDraftLLM } from "@/lib/ai/automation-generate";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  AiNotConfiguredError,
} from "@/lib/ai/errors";
import type { Draft } from "@/components/boards/automations/recipes";
import { fail, type ActionResult } from "@/lib/actions/result";

const generateAutomationDraftSchema = z.object({
  boardId: z.string().uuid(),
  // Bounded free text: it flows verbatim into the Anthropic prompt, so an
  // unbounded string is a token/cost-abuse vector.
  prompt: z.string().trim().min(3).max(1000),
});

/**
 * Turn a natural-language description into a validated, NOT-YET-PERSISTED
 * automation {@link Draft} that seeds the existing AutomationBuilder. The human
 * reviews it and clicks Save (createAutomation) — this action never writes.
 *
 * Entitlement-gated before any token spend; the board context (columns / groups
 * / members) is read server-side and projected to labels+ids only.
 */
export async function generateAutomationDraft(input: {
  boardId: string;
  prompt: string;
}): Promise<ActionResult<{ draft: Draft; warnings: string[] }>> {
  const parsed = generateAutomationDraftSchema.safeParse(input);
  if (!parsed.success)
    return fail("Describe the automation in 3 to 1000 characters.");
  const { boardId, prompt } = parsed.data;

  try {
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    await requireAiEntitlement(org.id, "automation_gen");

    const payload = await getBoardPayload(boardId);
    if (!payload) return fail("Board not found.");

    const members = await listOrgMembersCached(payload.board.org_id);
    const ctx = buildAutomationContext({
      columns: payload.columns,
      groups: payload.groups,
      members,
    });

    const user = await requireUser();
    const choice = modelFor("automation_gen");
    const rawDraft = await runAi(
      { orgId: org.id, userId: user.id, feature: "automation_gen" },
      async ({ adapter, apiKey }) => {
        const { draft, usage } = await generateAutomationDraftLLM(prompt, ctx, {
          adapter,
          apiKey,
          choice,
        });
        return { result: draft, usage, model: choice.model };
      },
    );

    const { draft, warnings } = validateAutomationDraft(rawDraft, ctx);
    if (!draft)
      return fail("Couldn't turn that into an automation — try rephrasing.");
    return { ok: true, data: { draft, warnings } };
  } catch (e) {
    if (e instanceof AiDisabledError)
      return fail("AI is turned off for your organization.");
    if (e instanceof AiQuotaExceededError)
      return fail("You've used this month's AI allowance.");
    if (e instanceof ByoKeyMissingError)
      return fail(
        "Your organization's AI key is missing — ask an admin to update Settings.",
      );
    if (e instanceof AiNotConfiguredError)
      return fail("Add an AI provider key in Settings to use AI.");
    return fail("AI generation failed. Please try again.");
  }
}
