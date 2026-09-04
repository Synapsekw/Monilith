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
  MEMORY_FRAMING_TOKENS,
  memoryNoteTokens,
} from "./document-budget";
import { buildMemoryBlock } from "./document-inject";

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
  // What this pins is narrower than it once claimed, and the difference is the
  // point: passing `memoryTokens: 0` must be BYTE-IDENTICAL to omitting the
  // argument. It does NOT pin the end-to-end budget — see "the prefix raise IS
  // a real cut" below, which does.
  it("passing zero memory is identical to passing none", () => {
    const withNothing = documentBudget(BIG);
    const withZero = documentBudget({ ...BIG, memoryTokens: 0 });
    const outputReserve = Math.min(16_000, Math.ceil(200_000 * 0.15));
    const free = 200_000 - outputReserve - BIG.prefixTokens - 200;
    expect(withNothing.budget).toBe(Math.floor(free * 0.5));
    expect(withNothing.memoryBudget).toBe(0);
    expect(withNothing.memoryNoteBudget).toBe(0);
    expect(withZero).toEqual(withNothing);
  });

  // =========================================================================
  // THE HONEST END-TO-END PIN.
  // =========================================================================
  //
  // The branch's compatibility claim was "an agent with no memory gets exactly
  // the number this function returned before Spec 2c, to the token". That is
  // true of the FUNCTION and false of the SYSTEM: `route.ts` passes
  // `ASSUMED_PREFIX_TOKENS`, which this branch raised 9_000 -> 9_500 to cover
  // the two new tool descriptors. So `free` falls 500 and `knowledge` falls 250
  // for EVERY agent — and `selectDocuments` is all-or-nothing, so an agent whose
  // attached set totals inside that 250-token window loses its ENTIRE document
  // set with the owner having changed nothing.
  //
  // The raise is correct — the descriptors really are in every run's prefix.
  // What was missing is that the cost be stated and measured, so it cannot grow
  // again unnoticed. This test measures it.
  it("the prefix raise IS a real cut to every agent's document budget", () => {
    const PRE_2C_PREFIX_TOKENS = 9_000;
    const before = documentBudget({
      ...BIG,
      prefixTokens: PRE_2C_PREFIX_TOKENS,
    });
    const after = documentBudget({
      ...BIG,
      prefixTokens: ASSUMED_PREFIX_TOKENS,
    });
    expect(after.budget).toBeLessThan(before.budget);
    expect(before.budget - after.budget).toBe(
      Math.floor((ASSUMED_PREFIX_TOKENS - PRE_2C_PREFIX_TOKENS) * 0.5),
    );
    // 250 tokens, ~1 KB of document text. Stated as a number so a future raise
    // has to come here and change it.
    expect(before.budget - after.budget).toBe(250);
  });

  it("memory pays for exactly what it has PLUS its framing, below its share", () => {
    const r = documentBudget({ ...BIG, memoryTokens: 1_200 });
    const base = documentBudget(BIG).budget;
    expect(r.memoryBudget).toBe(1_200 + MEMORY_FRAMING_TOKENS);
    expect(r.memoryNoteBudget).toBe(1_200);
    expect(r.budget).toBe(base - 1_200 - MEMORY_FRAMING_TOKENS);
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

  // Retitled to what it actually checks. It is a CHANGE DETECTOR on the
  // constant, nothing more — the claim that the raise is big enough to cover
  // `remember` and `forget` is verified where the descriptors live, in
  // `memory-tools.test.ts`, because only there can their real text be measured.
  it("ASSUMED_PREFIX_TOKENS is pinned (the raise is sized in memory-tools.test.ts)", () => {
    expect(ASSUMED_PREFIX_TOKENS).toBe(9_500);
  });
});

// ===========================================================================
// WHAT A NOTE ACTUALLY COSTS THE PROMPT
// ===========================================================================
//
// `token_estimate` is what the memory budget is measured against, so it has to
// price the RENDERED form. Pricing the bare value under-counted every note by
// its key plus four characters of punctuation, and ignored the block's own
// ~90-token framing entirely.
describe("memoryNoteTokens", () => {
  it("prices the line the prompt really carries, not the bare value", () => {
    const key = "dana-group";
    const value = "Dana's items are filed in Ops";
    expect(memoryNoteTokens(key, value)).toBe(
      estimateTokens(`- ${key}: ${value}`),
    );
    expect(memoryNoteTokens(key, value)).toBeGreaterThan(estimateTokens(value));
  });
});

describe("MEMORY_FRAMING_TOKENS", () => {
  it("prices the framing `buildMemoryBlock` really emits", () => {
    // Derived from the block itself: one note's line subtracted from the whole
    // rendered block leaves the framing, and that is what this constant must be
    // within a token of.
    const key = "k";
    const value = "v";
    const block = buildMemoryBlock([{ key, value }]);
    const framingOnly = estimateTokens(block) - memoryNoteTokens(key, value);
    expect(Math.abs(MEMORY_FRAMING_TOKENS - framingOnly)).toBeLessThanOrEqual(
      1,
    );
    // It is not a rounding error — it is roughly a hundred tokens of prompt
    // charged on every run of every agent that has any memory at all.
    expect(MEMORY_FRAMING_TOKENS).toBeGreaterThan(50);
  });

  it("is charged to memory once, and only when there IS memory", () => {
    const none = documentBudget(BIG);
    const some = documentBudget({ ...BIG, memoryTokens: 1_200 });
    // Nothing to frame, nothing charged — this is what keeps a memory-less
    // agent's prompt and budget exactly where they were.
    expect(none.memoryBudget).toBe(0);
    // With memory, the block's framing is charged ON TOP of the notes…
    expect(some.memoryBudget).toBe(1_200 + MEMORY_FRAMING_TOKENS);
    // …and `selectMemory` may only spend what is left for the LINES, or the
    // block it builds would overrun the budget it was sized against.
    expect(some.memoryNoteBudget).toBe(1_200);
    expect(some.budget).toBe(none.budget - 1_200 - MEMORY_FRAMING_TOKENS);
  });

  it("never lets the note budget go negative when the share is tiny", () => {
    const tiny = {
      contextLength: 16_385,
      prefixTokens: ASSUMED_PREFIX_TOKENS,
      instructionTokens: 200,
    };
    const r = documentBudget({ ...tiny, memoryTokens: 5_000 });
    expect(r.memoryNoteBudget).toBeGreaterThanOrEqual(0);
    expect(r.memoryBudget).toBeGreaterThanOrEqual(r.memoryNoteBudget);
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
