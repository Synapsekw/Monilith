import { describe, expect, it } from "vitest";
import { computeCostUsd, costToCredits } from "@/lib/ai/pricing";

describe("pricing", () => {
  it("computes claude-opus-4-8 cost from per-MTok prices ($5 in / $25 out)", () => {
    expect(
      computeCostUsd("claude-opus-4-8", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(30, 6);
    expect(
      computeCostUsd("claude-opus-4-8", {
        inputTokens: 2000,
        outputTokens: 500,
      }),
    ).toBeCloseTo(0.0225, 6);
  });

  it("prices the embedding model input-only ($0.02/MTok, output ignored)", () => {
    expect(
      computeCostUsd("text-embedding-3-small", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(0.02, 6);
    // output tokens carry a 0 rate — they never add cost even if present.
    expect(
      computeCostUsd("text-embedding-3-small", {
        inputTokens: 500_000,
        outputTokens: 999,
      }),
    ).toBeCloseTo(0.01, 6);
  });

  it("returns 0 for an unknown model (tokens still recorded upstream)", () => {
    expect(
      computeCostUsd("some-future-model", {
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBe(0);
  });

  it("converts cost to credits at 1 credit = $0.01, 2dp", () => {
    expect(costToCredits(0.0225)).toBe(2.25);
    expect(costToCredits(0.02255)).toBe(2.26);
    expect(costToCredits(0)).toBe(0);
  });

  it("prices sonnet-5 and haiku-4-5 at their standard per-MTok rates", () => {
    expect(
      computeCostUsd("claude-sonnet-5", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(18, 6);
    expect(
      computeCostUsd("claude-haiku-4-5", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(6, 6);
  });

  it("prices cache reads at 0.10x and cache writes at 1.25x the input rate", () => {
    // sonnet-5 input is $3/MTok -> read $0.30/MTok, write $3.75/MTok
    expect(
      computeCostUsd("claude-sonnet-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.3, 6);
    expect(
      computeCostUsd("claude-sonnet-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBeCloseTo(3.75, 6);
  });

  it("sums uncached input, cache reads, cache writes and output", () => {
    expect(
      computeCostUsd("claude-sonnet-5", {
        inputTokens: 1000, // 0.003
        outputTokens: 500, // 0.0075
        cacheReadTokens: 20_000, // 0.006
        cacheWriteTokens: 4_000, // 0.015
      }),
    ).toBeCloseTo(0.0315, 6);
  });

  it("is byte-identical to the pre-cache behaviour when cache fields are absent", () => {
    // Regression guard: every existing call site omits the new fields.
    expect(
      computeCostUsd("claude-opus-4-8", {
        inputTokens: 2000,
        outputTokens: 500,
      }),
    ).toBeCloseTo(0.0225, 6);
  });

  it("returns 0 for an unknown model even when cache tokens are present", () => {
    expect(
      computeCostUsd("some-future-model", {
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 50_000,
        cacheWriteTokens: 10_000,
      }),
    ).toBe(0);
  });
});
