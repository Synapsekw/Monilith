import {
  DESCRIPTION_MAX,
  SUBTASKS_MAX,
  SUBTASK_NAME_MAX,
  type ItemAssistProposal,
} from "@/lib/ai/item-assist/schema";

/**
 * Re-validate a raw item-assist proposal before it's ever shown to the user
 * or applied — mirrors validateProposal's discipline of never trusting raw
 * model output:
 *  - a proposed status.optionId MUST be one of ctx.statusOptionIds, else the
 *    whole status proposal is dropped (with a warning);
 *  - description is trimmed and capped to DESCRIPTION_MAX;
 *  - subtasks are capped to SUBTASKS_MAX entries, each trimmed and capped to
 *    SUBTASK_NAME_MAX, with empties dropped.
 */
export function validateItemAssist(
  proposal: ItemAssistProposal,
  ctx: { statusOptionIds?: Set<string> },
): { proposal: ItemAssistProposal; warnings: string[] } {
  const warnings: string[] = [];
  const out: ItemAssistProposal = {};

  if (typeof proposal.description === "string") {
    const trimmed = proposal.description.trim().slice(0, DESCRIPTION_MAX);
    if (trimmed.length > 0) out.description = trimmed;
  }

  if (Array.isArray(proposal.subtasks)) {
    const cleaned = proposal.subtasks
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim().slice(0, SUBTASK_NAME_MAX))
      .filter((s) => s.length > 0)
      .slice(0, SUBTASKS_MAX);
    if (cleaned.length > 0) out.subtasks = cleaned;
  }

  if (proposal.status) {
    const ids = ctx.statusOptionIds;
    if (ids?.has(proposal.status.optionId)) {
      out.status = proposal.status;
    } else {
      warnings.push(
        `Dropped status: option "${proposal.status.optionId}" is not a valid option for this column`,
      );
    }
  }

  return { proposal: out, warnings };
}
