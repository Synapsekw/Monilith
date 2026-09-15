import { describe, expect, it } from "vitest";
import {
  intelAskRequestSchema,
  MAX_ANSWER_CHARS,
  MAX_ASK_HISTORY,
  MAX_QUESTION_CHARS,
} from "./ask-input";

const base = {
  runId: "11111111-1111-4111-8111-111111111111",
  question: "What slipped?",
};

describe("intelAskRequestSchema", () => {
  it("accepts a question with no history", () => {
    expect(
      intelAskRequestSchema.parse({ ...base, history: [] }).history,
    ).toEqual([]);
  });

  // SHAPE is strict, SIZE truncates. A cap the model was never told about must
  // never throw AFTER the call is metered — the failed run leaves the input
  // hash unchanged, so every retry pays again and fails again (spec §3.1).
  it("truncates over-long history to the most recent pairs", () => {
    const history = Array.from({ length: MAX_ASK_HISTORY + 3 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`,
    }));
    const parsed = intelAskRequestSchema.parse({ ...base, history });
    expect(parsed.history).toHaveLength(MAX_ASK_HISTORY);
    expect(parsed.history.at(-1)?.question).toBe(`q${MAX_ASK_HISTORY + 2}`);
  });

  // Same rule, applied to the two string caps. A long prior answer is the
  // NORMAL outcome of "explain in more detail" (the prompt caps at four
  // sentences "unless asked for more"), so a reject here would 400 the user's
  // NEXT question and strand the tab until a reload.
  it("truncates an oversize question instead of rejecting it", () => {
    const question = "q".repeat(MAX_QUESTION_CHARS + 50);
    const parsed = intelAskRequestSchema.parse({
      ...base,
      question,
      history: [],
    });
    expect(parsed.question).toHaveLength(MAX_QUESTION_CHARS);
  });

  it("truncates an oversize prior answer instead of rejecting it", () => {
    const answer = "a".repeat(MAX_ANSWER_CHARS + 50);
    const question = "q".repeat(MAX_QUESTION_CHARS + 50);
    const parsed = intelAskRequestSchema.parse({
      ...base,
      history: [{ question, answer }],
    });
    expect(parsed.history[0].answer).toHaveLength(MAX_ANSWER_CHARS);
    expect(parsed.history[0].question).toHaveLength(MAX_QUESTION_CHARS);
  });

  // The slice runs BEFORE `pair` does, so a hostile body cannot make the
  // boundary validate thousands of objects to keep four.
  it("bounds the history array before validating its elements", () => {
    const history = Array.from({ length: 5_000 }, (_, i) => ({
      question: `q${i}`,
      // Everything the slice drops is unvalidatable on purpose: if the
      // elements were validated first, this body would throw instead of
      // parsing.
      ...(i < 5_000 - MAX_ASK_HISTORY ? {} : { answer: `a${i}` }),
    }));
    const parsed = intelAskRequestSchema.parse({ ...base, history });
    expect(parsed.history).toHaveLength(MAX_ASK_HISTORY);
    expect(parsed.history[0].question).toBe(`q${5_000 - MAX_ASK_HISTORY}`);
  });

  it("rejects a malformed history entry", () => {
    expect(() =>
      intelAskRequestSchema.parse({ ...base, history: [{ question: "q" }] }),
    ).toThrow();
  });

  it("rejects an empty question and a non-uuid runId", () => {
    expect(() =>
      intelAskRequestSchema.parse({ ...base, question: "  ", history: [] }),
    ).toThrow();
    expect(() =>
      intelAskRequestSchema.parse({ ...base, runId: "nope", history: [] }),
    ).toThrow();
  });
});
