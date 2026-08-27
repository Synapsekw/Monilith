import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  documentBudget,
  selectDocuments,
  selectMemory,
  MIN_USEFUL_BUDGET,
  NULL_CONTEXT_FALLBACK,
  MEMORY_MAX_TOKENS,
  MEMORY_SHARE,
  ASSUMED_PREFIX_TOKENS,
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

// ===========================================================================
// Spec 2c — memory's share of the SAME envelope.
// ===========================================================================

const BIG = {
  contextLength: 200_000,
  prefixTokens: 9_500,
  instructionTokens: 200,
};

describe("documentBudget with memory", () => {
  // THE REGRESSION PIN. Any change here silently shrinks every existing
  // agent's document budget and can flip a working, already-attached set to
  // documents_omitted at 07:00 with the owner having changed nothing.
  it("an agent with no memory gets the whole knowledge envelope", () => {
    const withNothing = documentBudget(BIG);
    const withZero = documentBudget({ ...BIG, memoryTokens: 0 });
    const outputReserve = Math.min(16_000, Math.ceil(200_000 * 0.15));
    const free = 200_000 - outputReserve - 9_500 - 200;
    expect(withNothing.budget).toBe(Math.floor(free * 0.5));
    expect(withNothing.memoryBudget).toBe(0);
    expect(withZero.budget).toBe(withNothing.budget);
  });

  it("memory pays for exactly what it has, below its share", () => {
    const r = documentBudget({ ...BIG, memoryTokens: 1_200 });
    const base = documentBudget(BIG).budget;
    expect(r.memoryBudget).toBe(1_200);
    expect(r.budget).toBe(base - 1_200);
  });

  it("memory is capped at MEMORY_MAX_TOKENS on a large model", () => {
    const r = documentBudget({ ...BIG, memoryTokens: 50_000 });
    expect(r.memoryBudget).toBe(MEMORY_MAX_TOKENS);
  });

  it("memory is capped at its share, not MEMORY_MAX_TOKENS, on a small model", () => {
    const small = {
      contextLength: 40_000,
      prefixTokens: 9_500,
      instructionTokens: 200,
    };
    const outputReserve = Math.min(16_000, Math.ceil(40_000 * 0.15));
    const knowledge = Math.floor((40_000 - outputReserve - 9_500 - 200) * 0.5);
    const r = documentBudget({ ...small, memoryTokens: 50_000 });
    expect(r.memoryBudget).toBe(Math.floor(knowledge * MEMORY_SHARE));
    expect(r.memoryBudget).toBeLessThan(MEMORY_MAX_TOKENS);
  });

  it("never overdraws the envelope", () => {
    const r = documentBudget({ ...BIG, memoryTokens: 999_999 });
    expect(r.budget).toBeGreaterThanOrEqual(0);
  });

  it("keeps `usable` about the DOCUMENT budget, not the memory one", () => {
    // Memory has no minimum: a model too small for documents can still carry
    // a handful of facts, and `usable` must keep its pre-2c meaning.
    const tiny = {
      contextLength: 16_385,
      prefixTokens: 9_500,
      instructionTokens: 200,
    };
    const r = documentBudget({ ...tiny, memoryTokens: 400 });
    expect(r.usable).toBe(r.budget >= MIN_USEFUL_BUDGET);
  });

  it("ASSUMED_PREFIX_TOKENS covers the two new tool descriptors", () => {
    expect(ASSUMED_PREFIX_TOKENS).toBe(9_500);
  });
});

describe("selectMemory", () => {
  const note = (key: string, tokenEstimate: number, updatedAt: string) => ({
    key,
    tokenEstimate,
    updatedAt,
  });

  it("keeps the freshest and reports what it dropped", () => {
    const r = selectMemory(
      [
        note("old", 100, "2026-01-01T00:00:00Z"),
        note("new", 100, "2026-08-01T00:00:00Z"),
      ],
      100,
    );
    expect(r.included.map((n) => n.key)).toEqual(["new"]);
    expect(r.dropped).toBe(1);
  });

  it("renders the kept set in KEY order, not recency order", () => {
    const r = selectMemory(
      [
        note("zulu", 10, "2026-08-03T00:00:00Z"),
        note("alpha", 10, "2026-08-01T00:00:00Z"),
      ],
      1_000,
    );
    expect(r.included.map((n) => n.key)).toEqual(["alpha", "zulu"]);
    expect(r.dropped).toBe(0);
  });

  it("is partial, unlike selectDocuments — one oversized note does not cost the rest", () => {
    const r = selectMemory(
      [
        note("huge", 5_000, "2026-08-03T00:00:00Z"),
        note("small-a", 10, "2026-08-02T00:00:00Z"),
        note("small-b", 10, "2026-08-01T00:00:00Z"),
      ],
      100,
    );
    expect(r.included.map((n) => n.key)).toEqual(["small-a", "small-b"]);
    expect(r.dropped).toBe(1);
  });

  it("drops everything when the budget is zero", () => {
    const r = selectMemory([note("a", 1, "2026-08-01T00:00:00Z")], 0);
    expect(r.included).toEqual([]);
    expect(r.dropped).toBe(1);
  });

  it("breaks updated_at ties by key so the result is deterministic", () => {
    const same = "2026-08-01T00:00:00Z";
    const r = selectMemory([note("b", 10, same), note("a", 10, same)], 10);
    expect(r.included.map((n) => n.key)).toEqual(["a"]);
  });

  it("is empty and drops nothing for an agent with no notes", () => {
    const r = selectMemory([], 1_000);
    expect(r.included).toEqual([]);
    expect(r.dropped).toBe(0);
  });
});
