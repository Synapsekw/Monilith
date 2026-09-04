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

import { MEMORY_FRAMING } from "./document-inject";

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
 * Hard ceiling on notes per agent.
 *
 * Enforced in `agent_remember`, and enforced ATOMICALLY only because that
 * function takes a `for update` lock on the parent `user_agents` row before it
 * counts (20260827105257). Count-then-insert is NOT atomic by itself: at READ
 * COMMITTED two concurrent runs of the same agent both read 49 and both insert.
 * Mirrored here for the UI's `47 of 50` counter, which is a display, never the
 * enforcement point — a check-then-insert from TypeScript has no lock at all.
 */
export const MEMORY_MAX_NOTES = 50;

/**
 * Matches the `agent_memory.value` check constraint exactly.
 *
 * 380, NOT 500, AND THE NUMBER IS DERIVED RATHER THAN CHOSEN. The proposal card
 * an owner approves is a single server-written sentence,
 * `Remember this for every future run, as "<key>": "<value>"` — 45 characters
 * of frame — and `user_agent_proposals.summary` clamps at 500 with an ellipsis.
 * `ProposalCard` renders that sentence and nothing else (`proposals-db.ts`
 * deliberately excludes `input`), so it is the ONLY place a not-yet-approved
 * note can be read. At 500 the longest legal note could therefore be approved
 * with its TAIL HIDDEN: benign prose on the card, the payload past the clamp,
 * and the FULL value entering every future system prompt.
 *
 * 45 (frame) + 64 (MEMORY_MAX_KEY_CHARS) + 380 = 489 <= 500, so no valid note
 * can produce a clamped summary. `proposal-summary.test.ts` derives that bound
 * from the real sentence and fails if a rewording eats the headroom.
 */
export const MEMORY_MAX_VALUE_CHARS = 380;

/** Matches the `agent_memory.key` check constraint exactly. */
export const MEMORY_MAX_KEY_CHARS = 64;

/**
 * What ONE note costs the prompt — the RENDERED line, not the bare value.
 *
 * `buildMemoryBlock` emits `- <key>: <value>`, so the key and four characters
 * of punctuation are real prompt tokens. Pricing the value alone under-counted
 * every note by up to 17 tokens (a 64-character key), and `token_estimate` is
 * precisely the number the memory budget is then measured against — so the
 * under-count spent tokens the budget believed were free.
 *
 * The `\n` that joins the lines is not counted: it is one character against an
 * estimator whose whole resolution is four, and the framing below already
 * carries more slack than that.
 */
export function memoryNoteTokens(key: string, value: string): number {
  return estimateTokens(`- ${key}: ${value}`);
}

/**
 * What the memory block's FRAMING costs — roughly a hundred tokens, charged on
 * every run of every agent that has any memory at all, and previously counted
 * nowhere.
 *
 * Derived from the literal `buildMemoryBlock` emits, never restated: a second
 * copy of that prose would drift silently, and the drift would show up as a
 * memory block that overruns the budget it was sized against.
 */
export const MEMORY_FRAMING_TOKENS = estimateTokens(MEMORY_FRAMING);

/**
 * The absolute ceiling on injected memory, regardless of how large the model
 * is. Chosen so a COMPLETELY FULL memory fits on a large model, and no larger:
 * a 1M-context model does not need 250k tokens of an agent's own notes.
 *
 * The worst case is 50 notes at MEMORY_MAX_VALUE_CHARS with
 * MEMORY_MAX_KEY_CHARS keys, rendered as `- <key>: <value>` — 50 x ceil(448/4)
 * = 5,600 tokens — plus MEMORY_FRAMING_TOKENS once. Comfortably inside 8,000,
 * with room for the value ceiling to move.
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
 * `memoryTokens` defaults to 0, and that default is a COMPATIBILITY GUARANTEE
 * ABOUT THIS FUNCTION: for a given `prefixTokens`, an agent with no memory gets
 * exactly the number this returned before Spec 2c, to the token — no framing is
 * charged, because there is no block to frame. Any other choice would shrink
 * every existing agent's document budget, and `selectDocuments` is
 * all-or-nothing, so a shrink can flip a working, already-attached set to
 * `documents_omitted` overnight with the owner having changed nothing.
 *
 * BE PRECISE ABOUT WHAT THAT DOES AND DOES NOT PROMISE, because the branch's
 * first draft of this comment over-claimed. It is NOT an end-to-end guarantee.
 * `route.ts` passes `ASSUMED_PREFIX_TOKENS`, which Spec 2c raised 9_000 ->
 * 9_500 to cover the `remember` and `forget` descriptors that now sit in EVERY
 * run's prefix. So `free` falls 500 and this function's `budget` falls 250 for
 * every agent, memory or not — a real, deliberate cut, and an agent whose
 * attached documents total inside that 250-token window does lose the whole
 * set. The raise is correct; what matters is that the cost is stated and
 * measured. `document-budget.test.ts`'s "the prefix raise IS a real cut" pins
 * the 250 so a further raise cannot pass unnoticed.
 */
export function documentBudget(args: {
  contextLength: number | null;
  prefixTokens: number;
  instructionTokens: number;
  /** The agent's ACTUAL total memory cost, summed from `token_estimate`. */
  memoryTokens?: number;
}): {
  budget: number;
  /** What the whole memory BLOCK costs, framing included. */
  memoryBudget: number;
  /** What `selectMemory` may spend on note LINES — `memoryBudget` less the
   *  framing. Passing `memoryBudget` there would let the rendered block
   *  overrun the envelope it was sized against by the framing's length. */
  memoryNoteBudget: number;
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
  // The block's own framing is charged ON TOP of the notes, and ONLY when there
  // is at least one note to frame — it is ~100 tokens of prompt that used to be
  // spent by nobody's budget. Zero notes still costs exactly zero, which is the
  // compatibility guarantee above.
  const noteTokens = Math.max(0, args.memoryTokens ?? 0);
  const wanted = noteTokens > 0 ? noteTokens + MEMORY_FRAMING_TOKENS : 0;
  const memoryBudget = Math.min(wanted, memoryShare);
  const memoryNoteBudget =
    memoryBudget > 0 ? Math.max(0, memoryBudget - MEMORY_FRAMING_TOKENS) : 0;
  const budget = knowledge - memoryBudget;

  // `usable` keeps its pre-2c meaning: it is about the DOCUMENT budget and
  // MIN_USEFUL_BUDGET. Memory has no minimum — two notes are worth having, and
  // a model too small for documents can still carry a handful of facts.
  return {
    budget,
    memoryBudget,
    memoryNoteBudget,
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
