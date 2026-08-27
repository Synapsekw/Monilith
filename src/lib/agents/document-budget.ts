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
 *
 * Raised 9_000 -> 9_500 by Spec 2c: `remember` and `forget` are added to EVERY
 * run's descriptor list (the grant gate DENIES, it does not hide), so they sit
 * in the prefix whether or not the agent may write memory. Leaving it at 9_000
 * would make the meter wrong by construction the moment memory shipped. The
 * cost is ~250 tokens off every agent's document budget (half of 500), which
 * only binds on a model already near `MIN_USEFUL_BUDGET`.
 */
export const ASSUMED_PREFIX_TOKENS = 9_500;

/**
 * Hard ceiling on notes per agent. Enforced ATOMICALLY in `agent_remember`
 * (a check-then-insert from TypeScript is a TOCTOU race whose losing side is a
 * silently-51st note) and mirrored here for the UI's `47 of 50` counter.
 */
export const MEMORY_MAX_NOTES = 50;

/** Matches the `agent_memory.value` check constraint exactly. */
export const MEMORY_MAX_VALUE_CHARS = 500;

/** Matches the `agent_memory.key` check constraint exactly. */
export const MEMORY_MAX_KEY_CHARS = 64;

/**
 * The absolute ceiling on injected memory, regardless of how large the model
 * is. Chosen so a COMPLETELY FULL memory (50 notes x ~500 chars plus keys,
 * ~7.1k tokens) fits on a large model, and no larger: a 1M-context model does
 * not need 250k tokens of an agent's own notes.
 */
export const MEMORY_MAX_TOKENS = 8_000;

/**
 * Memory's share of the SAME knowledge envelope reference documents draw on.
 *
 * A quarter, not a fixed reserve, so a small model's memory shrinks
 * proportionally rather than consuming tokens it cannot spare. On a large
 * model the share never binds — MEMORY_MAX_TOKENS does.
 */
export const MEMORY_SHARE = 0.25;

/**
 * How the ONE knowledge envelope is divided between reference documents and
 * memory. There is deliberately no second budget function: two would drift,
 * and the drift would be invisible until 07:00.
 *
 * The `* 0.5` is load-bearing and UNCHANGED. The other half is reserved for up
 * to AGENT_MAX_STEPS (12) steps of accumulating tool results, which are
 * in-context and bounded by nothing except the tools' own response shapes.
 * Documents and memory are the only parts of the prompt known in advance, so
 * they are the only parts that CAN be budgeted — which is exactly why they
 * must not claim all of it.
 *
 * `memoryTokens` defaults to 0, and that default is the COMPATIBILITY
 * GUARANTEE, not a convenience: an agent with no memory must get exactly the
 * number this function returned before Spec 2c, to the token. Any other choice
 * silently shrinks every existing agent's document budget and can flip a
 * working, already-attached document set to `documents_omitted` overnight with
 * the owner having changed nothing. `document-budget.test.ts` pins it.
 */
export function documentBudget(args: {
  contextLength: number | null;
  prefixTokens: number;
  instructionTokens: number;
  /** The agent's ACTUAL total memory cost, summed from `token_estimate`. */
  memoryTokens?: number;
}): {
  budget: number;
  memoryBudget: number;
  usable: boolean;
  assumedContext: boolean;
} {
  const assumedContext = args.contextLength === null;
  const context = args.contextLength ?? NULL_CONTEXT_FALLBACK;

  const outputReserve = Math.min(MAX_OUTPUT_RESERVE, Math.ceil(context * 0.15));
  const free =
    context - outputReserve - args.prefixTokens - args.instructionTokens;
  const knowledge = Math.max(0, Math.floor(free * 0.5));

  // Memory pays for what it HAS, capped at its share: it cannot creep, and
  // documents cannot be starved by a large memory.
  const memoryShare = Math.min(
    MEMORY_MAX_TOKENS,
    Math.floor(knowledge * MEMORY_SHARE),
  );
  const memoryBudget = Math.min(
    Math.max(0, args.memoryTokens ?? 0),
    memoryShare,
  );
  const budget = knowledge - memoryBudget;

  // `usable` keeps its pre-2c meaning: it is about the DOCUMENT budget and
  // MIN_USEFUL_BUDGET. Memory has no minimum — two notes are worth having, and
  // a model too small for documents can still carry a handful of facts.
  return {
    budget,
    memoryBudget,
    usable: budget >= MIN_USEFUL_BUDGET,
    assumedContext,
  };
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

/**
 * Partial selection — and the divergence from `selectDocuments` is deliberate.
 *
 * `selectDocuments` is all-or-nothing because a document FRAGMENT misleads:
 * the agent cannot tell it is reading half a policy. Memory notes are
 * independent ATOMS — dropping note 41 does not make notes 1-40 wrong. Making
 * memory all-or-nothing would mean one over-long note silently costs the agent
 * everything it knows, which is strictly worse than dropping that note.
 *
 * TWO ORDERS, on purpose:
 *   - KEEP by `updated_at desc`, so a full memory can still learn something
 *     new (a memory whose oldest note is immortal cannot).
 *   - RENDER by `key asc`, so replacing one note's value changes only that
 *     note's LINE rather than permuting the whole block. Anthropic's cache is
 *     a PREFIX cache: a permuted block invalidates everything after its first
 *     changed byte, and the memory block sits late in the prompt precisely to
 *     keep that suffix small.
 *
 * `continue` rather than `break`: a small older note may still fit after a
 * large fresh one is skipped. `updated_at` ties are broken by key so the
 * result is deterministic for a given input set.
 */
export function selectMemory<
  T extends { key: string; tokenEstimate: number; updatedAt: string },
>(notes: readonly T[], budget: number): { included: T[]; dropped: number } {
  const freshestFirst = [...notes].sort((a, b) =>
    a.updatedAt === b.updatedAt
      ? a.key.localeCompare(b.key)
      : a.updatedAt < b.updatedAt
        ? 1
        : -1,
  );

  const kept: T[] = [];
  let spent = 0;
  for (const n of freshestFirst) {
    if (spent + n.tokenEstimate > budget) continue;
    kept.push(n);
    spent += n.tokenEstimate;
  }

  kept.sort((a, b) => a.key.localeCompare(b.key));
  return { included: kept, dropped: notes.length - kept.length };
}
