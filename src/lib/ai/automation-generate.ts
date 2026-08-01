import "server-only";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import type { ModelChoice } from "@/lib/ai/model-map";
import type { Draft } from "@/components/boards/automations/recipes";
import type { AutomationContext } from "@/lib/ai/automation-context";
import {
  AUTOMATION_DRAFT_JSON_SCHEMA,
  type RawAutomationDraft,
} from "@/lib/ai/automation-gen-schema";

/**
 * System prompt teaching the model the trigger/action vocabulary and the
 * ids-only contract. Frozen + prompt-cached (see generateAutomationDraft) so the
 * cache prefix stays stable across requests.
 *
 * The engine matches RAW ids — there is no name→id resolver — so the model MUST
 * reference only ids present in the supplied context and resolve NL values
 * ("Done", "Archive") to option/group ids by label itself.
 */
export function buildAutomationGenSystemPrompt(): string {
  return [
    "You build a single automation rule for a Monday-style work board from a natural-language description.",
    "An automation is one trigger plus one or more actions (optionally a name).",
    "Triggers:",
    "- status_changed: { columnId (a status/dropdown column), toOptionId? } — omit toOptionId to fire on ANY change, else copy an option id from that column.",
    "- item_created: {} — fires when a new item is added.",
    "- person_assigned: { columnId (a people column) }.",
    "- date_reached: { columnId (a date column), offsetDays } — negative = before the date, 0 = on it, positive = after.",
    "- percent_reached: { columnId (a percent column), percent }.",
    "Actions:",
    "- notify: { recipient: { kind:'owner', peopleColumnId } | { kind:'member', userId } }.",
    "- set_option: { columnId (status/dropdown), optionId } — copy an option id from that column.",
    "- set_percent: { columnId (percent), percent }.",
    "- move_to_group: { groupId }.",
    "CRITICAL: reference ONLY ids that appear in the provided context. To honor a named status/group/person (e.g. 'when it's Done', 'move to Archive', 'notify Ada'), find the matching label in the context and copy its id. Never invent ids or UUIDs.",
    "If the request maps to more than one action, include them all. Give the rule a short human name.",
  ].join("\n");
}

function buildUserPrompt(prompt: string, ctx: AutomationContext): string {
  return [
    "Board context (columns, options, groups, members — labels + ids only):",
    JSON.stringify(ctx),
    "",
    `Describe-an-automation request: ${prompt}`,
  ].join("\n");
}

/**
 * Generate a raw automation draft from an NL prompt + board context. The adapter
 * + key are resolved by the metered AI gateway (runAi) and passed in — this
 * function never resolves credentials, so every call is entitlement-gated and
 * metered by the caller. The result is UNVALIDATED; the caller runs
 * validateAutomationDraft() for referential integrity.
 */
export async function generateAutomationDraft(
  prompt: string,
  ctx: AutomationContext,
  opts: { adapter: ProviderAdapter; apiKey: string; choice?: ModelChoice },
): Promise<{ draft: Draft; usage: AiUsageTokens; model: string }> {
  const { data, usage, model } =
    await opts.adapter.generateStructured<RawAutomationDraft>({
      apiKey: opts.apiKey,
      system: buildAutomationGenSystemPrompt(),
      user: buildUserPrompt(prompt, ctx),
      schema: AUTOMATION_DRAFT_JSON_SCHEMA,
      choice: opts.choice,
    });
  // The shape matches Draft closely enough for the caller, which re-validates.
  return { draft: data as unknown as Draft, usage, model };
}
