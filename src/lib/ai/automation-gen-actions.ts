"use server";
import * as z from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { getBoardAccess, getBoardPayload } from "@/lib/boards/queries";
import { listVisibleOrgMembers } from "@/lib/org/visible-roster";
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
    // A draft exists only to be saved, and saving is `can_edit_board`. Refuse
    // a viewer here, before the entitlement check and any token spend, rather
    // than metering a draft they can never keep. No access at all reads the
    // same as a missing board.
    const access = await getBoardAccess(boardId);
    if (!access) return fail("Board not found.");
    if (access === "viewer")
      return fail("Only editors can create automations on this board.");
    await requireAiEntitlement(org.id, "automation_gen");

    const payload = await getBoardPayload(boardId);
    if (!payload) return fail("Board not found.");

    const members = await listVisibleOrgMembers(payload.board.org_id);
    const ctx = buildAutomationContext({
      columns: payload.columns,
      groups: payload.groups,
      members,
    });

    const user = await requireUser();
    const rawDraft = await runAi(
      { orgId: org.id, userId: user.id, feature: "automation_gen" },
      async ({ adapter, apiKey, baseUrl, model }) => {
        // See actions.ts: the WIRE id goes to the provider, and runAi meters
        // the catalog row it resolved.
        const { draft, usage } = await generateAutomationDraftLLM(prompt, ctx, {
          adapter,
          apiKey,
          baseUrl,
          model: model.requestModel,
        });
        return { result: draft, usage };
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
