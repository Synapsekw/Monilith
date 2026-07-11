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
    expect(costToCredits(0)).toBe(0);
  });
});
