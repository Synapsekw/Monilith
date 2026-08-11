"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createServiceClient } from "@/lib/supabase/service";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  AiNotConfiguredError,
} from "@/lib/ai/errors";
import { AI_STEP_ALLOWED_ACTIONS } from "@/lib/validations/automations";
import type { AutomationAction } from "@/lib/validations/automations";
import { fail, type ActionResult } from "@/lib/actions/result";
import { buildJobContext } from "./context";
import { decideAction } from "./decide";

const FEATURE = "automation_ai_step";

const previewSchema = z.object({
  boardId: z.string().uuid(),
  instruction: z.string().trim().min(3).max(500),
  allow: z.array(z.enum(AI_STEP_ALLOWED_ACTIONS)).min(1),
});

export type AiStepPreview = {
  action: AutomationAction | null;
  warnings: string[];
  sampleItem: { id: string; name: string } | null;
};

/**
 * "Test this step" dry-run (spec §4.1 #6). Runs the F13 decision loop against a
 * SAMPLE item (the board's most recent) and returns the chosen action WITHOUT
 * applying it — the confined executor is never called. Entitlement-gated before
 * any token spend, exactly like the fire-time endpoint.
 */
export async function previewAiStep(input: {
  boardId: string;
  instruction: string;
  allow: string[];
}): Promise<ActionResult<AiStepPreview>> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      "Add an instruction (3-500 chars) and at least one allowed action.",
    );
  const { boardId, instruction, allow } = parsed.data;

  try {
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    await requireAiEntitlement(org.id, FEATURE);

    const svc = createServiceClient();
    // Scope the board to the active org (the service client bypasses RLS).
    const { data: board } = await svc
      .from("boards")
      .select("id, org_id")
      .eq("id", boardId)
      .maybeSingle();
    if (!board || board.org_id !== org.id) return fail("Board not found.");

    // Sample the board's most recent top-level item to decide against.
    const { data: sample } = await svc
      .from("items")
      .select("id, name")
      .eq("board_id", boardId)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sample)
      return {
        ok: true,
        data: { action: null, warnings: [], sampleItem: null },
      };

    const context = await buildJobContext(svc, {
      orgId: org.id,
      boardId,
      itemId: sample.id,
    });

    const user = await requireUser();
    const result = await runAi(
      { orgId: org.id, userId: user.id, feature: FEATURE },
      async ({ apiKey, model }) => {
        const r = await decideAction({
          apiKey,
          model: model.requestModel,
          context,
          instruction,
          allow,
        });
        return { result: r, usage: r.usage };
      },
    );

    return {
      ok: true,
      data: {
        action: result.action,
        warnings: result.warnings,
        sampleItem: { id: sample.id, name: sample.name },
      },
    };
  } catch (e) {
    if (e instanceof AiDisabledError)
      return fail("AI is turned off for your organization.");
    if (e instanceof AiQuotaExceededError)
      return fail("You've used this month's AI allowance.");
    if (e instanceof ByoKeyMissingError)
      return fail("Your organization's AI key is missing — ask an admin.");
    if (e instanceof AiNotConfiguredError)
      return fail("Add an AI provider key in Settings to use AI.");
    return fail("Couldn't test the step. Please try again.");
  }
}
