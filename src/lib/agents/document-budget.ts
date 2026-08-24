/**
 * The canonical token estimator and the reference-document context budget.
 *
 * Deliberately free of `server-only`: the attach-time meter is a client
 * component and must compute the same number the run loop will, from the same
 * code. Two estimators would mean the meter says "fits" and the run says
 * "omitted", which is the one failure the meter exists to prevent.
 *
 * Spec 2c (memory) consumes this module and must NOT re-derive the arithmetic.
 */

/**
 * ~4 characters per token. Crude, provider-independent, and deliberately the
 * ONLY estimator in the codebase — this replaces the inline expression that
 * lived at board-snapshot.ts:171.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Below this, a document library is not worth offering at all. */
export const MIN_USEFUL_BUDGET = 4_000;

/**
 * Used when `ai_models.context_length` is null. DEFENSIVE ONLY: as of
 * 2026-08-24 every one of the 105 active tool-capable models has a context
 * length (minimum 16,385), and `pickModel` selects only from active rows, so
 * the three null-context rows (all retired) can never reach the run loop. This
 * exists because the catalog is fed by a daily refresh and a future feed row
 * with a missing context window must degrade conservatively, never to NaN.
 */
export const NULL_CONTEXT_FALLBACK = 32_000;

/** Ceiling on the output reserve, in tokens. */
export const MAX_OUTPUT_RESERVE = 16_000;

/**
 * What the tool definitions plus PREAMBLE cost, in tokens.
 *
 * run-loop.ts's own comment measures this prefix at "~6-9k tokens" for the 25
 * descriptors a run passes. Take the PESSIMISTIC end: a meter that promises
 * room the run does not have is worse than one that under-promises, because
 * the owner only discovers the difference at 07:00.
 *
 * Lives here, not at the call sites, so the run loop and the attach-time meter
 * cannot drift — they must compute the same budget from the same inputs or the
 * meter's guarantee is void.
 */
export const ASSUMED_PREFIX_TOKENS = 9_000;

/**
 * How many tokens of reference documents this run can afford.
 *
 * The `* 0.5` is load-bearing. The other half is reserved for up to
 * AGENT_MAX_STEPS (12) steps of accumulating tool results, which are in-context
 * and bounded by nothing except the tools' own response shapes. Documents are
 * the only part of the prompt known in advance, so they are the only part that
 * CAN be budgeted — which is exactly why they must not claim all of it.
 */
export function documentBudget(args: {
  contextLength: number | null;
  prefixTokens: number;
  instructionTokens: number;
}): { budget: number; usable: boolean; assumedContext: boolean } {
  const assumedContext = args.contextLength === null;
  const context = args.contextLength ?? NULL_CONTEXT_FALLBACK;

  const outputReserve = Math.min(MAX_OUTPUT_RESERVE, Math.ceil(context * 0.15));
  const free =
    context - outputReserve - args.prefixTokens - args.instructionTokens;
  const budget = Math.max(0, Math.floor(free * 0.5));

  return { budget, usable: budget >= MIN_USEFUL_BUDGET, assumedContext };
}

/**
 * All-or-nothing selection.
 *
 * NOTHING TRUNCATES, and nothing is partially included. A half-injected policy
 * document is worse than none: the agent cannot tell it is reading a fragment
 * and will act on the visible half with full confidence. Dropping the whole set
 * is legible; a silent half is not.
 */
export function selectDocuments<T extends { tokenEstimate: number }>(
  docs: readonly T[],
  budget: number,
): { included: T[]; omitted: boolean } {
  const total = docs.reduce((n, d) => n + d.tokenEstimate, 0);
  if (docs.length === 0) return { included: [], omitted: false };
  if (total <= budget) return { included: [...docs], omitted: false };
  return { included: [], omitted: true };
}
