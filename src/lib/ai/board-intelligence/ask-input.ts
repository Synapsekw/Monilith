import { z } from "zod";
import { truncate } from "./schema";

/** Pairs kept in the tab and replayed as context (spec §3.2). */
export const MAX_ASK_HISTORY = 4;
/** Character budgets. They TRUNCATE, so they are budgets, not gates. */
export const MAX_QUESTION_CHARS = 500;
export const MAX_ANSWER_CHARS = 4000;

/**
 * Strict on SHAPE, TRUNCATING on SIZE — the rule for every cap in this module.
 *
 * A missing or non-string field is a broken client and must fail loudly. A
 * 4001-character prior answer is not: the system prompt caps answers at four
 * sentences "unless asked for more", so a long answer is the NORMAL outcome of
 * "explain in more detail" — and rejecting it would 400 the user's NEXT
 * question and strand the tab until a reload, over a limit the client was never
 * told about. Same reasoning as `schema.ts`'s output caps, and the same
 * `truncate`: no request the client could not have predicted ever fails.
 */
const capped = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((t) => truncate(t, max));

const pair = z.object({
  question: capped(MAX_QUESTION_CHARS),
  answer: capped(MAX_ANSWER_CHARS),
});

export const intelAskRequestSchema = z.object({
  runId: z.string().uuid(),
  question: capped(MAX_QUESTION_CHARS),
  /**
   * Keep the most recent pairs rather than rejecting a too-long history.
   *
   * Bounded BEFORE the elements are validated: a route handler has no default
   * body-size limit, so validating 100k pairs to keep four would hand a hostile
   * body a free CPU amplifier. The slice is the cheap operation; `pair` runs
   * only on the survivors.
   */
  history: z.preprocess(
    (v) => (Array.isArray(v) ? v.slice(-MAX_ASK_HISTORY) : v),
    z.array(pair),
  ),
});
export type IntelAskRequest = z.infer<typeof intelAskRequestSchema>;
