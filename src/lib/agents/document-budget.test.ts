import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  documentBudget,
  selectDocuments,
  MIN_USEFUL_BUDGET,
  NULL_CONTEXT_FALLBACK,
} from "./document-budget";

describe("estimateTokens", () => {
  it("is length/4 rounded up", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("is 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("documentBudget", () => {
  it("reserves 15% of context for output, capped at 16k", () => {
    // 200k * 0.15 = 30_000, capped to 16_000.
    // free = 200_000 - 16_000 - 8_000 - 500 = 175_500; half = 87_750
    const r = documentBudget({
      contextLength: 200_000,
      prefixTokens: 8_000,
      instructionTokens: 500,
    });
    expect(r.budget).toBe(87_750);
    expect(r.usable).toBe(true);
    expect(r.assumedContext).toBe(false);
  });

  it("uses the percentage when it is below the 16k cap", () => {
    // 16_385 * 0.15 = 2457.75 -> ceil 2458
    // free = 16_385 - 2_458 - 8_000 - 500 = 5_427; half = 2_713
    const r = documentBudget({
      contextLength: 16_385,
      prefixTokens: 8_000,
      instructionTokens: 500,
    });
    expect(r.budget).toBe(2_713);
    expect(r.usable).toBe(false); // below MIN_USEFUL_BUDGET
  });

  it("falls back to a conservative context when context_length is null", () => {
    const r = documentBudget({
      contextLength: null,
      prefixTokens: 8_000,
      instructionTokens: 500,
    });
    // 32_000 * 0.15 = 4_800; free = 32_000 - 4_800 - 8_000 - 500 = 18_700
    expect(r.budget).toBe(9_350);
    expect(r.assumedContext).toBe(true);
  });

  it("never returns a negative budget", () => {
    const r = documentBudget({
      contextLength: 16_385,
      prefixTokens: 50_000,
      instructionTokens: 0,
    });
    expect(r.budget).toBe(0);
    expect(r.usable).toBe(false);
  });

  it("marks a budget below MIN_USEFUL_BUDGET unusable", () => {
    const r = documentBudget({
      contextLength: 19_300,
      prefixTokens: 8_000,
      instructionTokens: 500,
    });
    // 19_300 * 0.15 = 2_895
    // free = 19_300 - 2_895 - 8_000 - 500 = 7_905; half = 3_952
    expect(r.budget).toBeLessThan(MIN_USEFUL_BUDGET);
    expect(r.usable).toBe(false);
  });

  it("a null context is EXACTLY the fallback context, only flagged", () => {
    // The property, rather than restating the constant: `null` must produce
    // the same arithmetic as passing NULL_CONTEXT_FALLBACK explicitly, and
    // differ ONLY in `assumedContext` — which is what tells the picker to
    // disclose that it is guessing.
    const args = { prefixTokens: 8_000, instructionTokens: 500 };
    const assumed = documentBudget({ contextLength: null, ...args });
    const explicit = documentBudget({
      contextLength: NULL_CONTEXT_FALLBACK,
      ...args,
    });
    expect(assumed.budget).toBe(explicit.budget);
    expect(assumed.usable).toBe(explicit.usable);
    expect(assumed.assumedContext).toBe(true);
    expect(explicit.assumedContext).toBe(false);
  });
});

describe("selectDocuments", () => {
  const docs = [
    { id: "a", tokenEstimate: 1_000 },
    { id: "b", tokenEstimate: 2_000 },
  ];

  it("includes everything when the set fits", () => {
    const r = selectDocuments(docs, 5_000);
    expect(r.included).toHaveLength(2);
    expect(r.omitted).toBe(false);
  });

  it("includes everything when the set exactly fits", () => {
    const r = selectDocuments(docs, 3_000);
    expect(r.included).toHaveLength(2);
    expect(r.omitted).toBe(false);
  });

  it("DROPS ALL, never some, when the set does not fit", () => {
    const r = selectDocuments(docs, 2_500);
    expect(r.included).toEqual([]);
    expect(r.omitted).toBe(true);
  });

  it("is not omitted when there are no documents at all", () => {
    const r = selectDocuments([], 0);
    expect(r.included).toEqual([]);
    expect(r.omitted).toBe(false);
  });
});
