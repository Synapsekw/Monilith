import { describe, expect, it } from "vitest";
import { intelAskRequestSchema, MAX_ASK_HISTORY } from "./ask-input";

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
