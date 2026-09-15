import { z } from "zod";

/** Pairs kept in the tab and replayed as context (spec §3.2). */
export const MAX_ASK_HISTORY = 4;

const pair = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(4000),
});

export const intelAskRequestSchema = z.object({
  runId: z.string().uuid(),
  question: z.string().trim().min(1).max(500),
  /** Strict on shape, TRUNCATING on size: keep the most recent pairs rather
   *  than rejecting a request the client could not have known was too long. */
  history: z.array(pair).transform((h) => h.slice(-MAX_ASK_HISTORY)),
});
export type IntelAskRequest = z.infer<typeof intelAskRequestSchema>;
