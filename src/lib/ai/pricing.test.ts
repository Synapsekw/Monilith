import { describe, expect, it } from "vitest";
import {
  computeCostUsd,
  costToCredits,
  ratesForModel,
  type ModelRates,
} from "@/lib/ai/pricing";

const SONNET: ModelRates = {
  input: 3,
  output: 15,
  cacheRead: null,
  cacheWrite: null,
};

describe("computeCostUsd", () => {
  it("bills input and output at the supplied rates", () => {
    expect(
      computeCostUsd(SONNET, { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBeCloseTo(3, 9);
    expect(
      computeCostUsd(SONNET, { inputTokens: 0, outputTokens: 1_000_000 }),
    ).toBeCloseTo(15, 9);
  });

  it("falls back to the Anthropic multipliers when a provider publishes no cache rate", () => {
    // 0.1x input for reads, 1.25x for writes — preserves today's billing
    // exactly for any model whose feed entry omits cache pricing.
    expect(
      computeCostUsd(SONNET, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.3, 9);
    expect(
      computeCostUsd(SONNET, {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1_000_000,
      }),
    ).toBeCloseTo(3.75, 9);
  });

  it("prefers an explicit cache rate over the multiplier", () => {
    const explicit: ModelRates = {
      input: 3,
      output: 15,
      cacheRead: 0.5,
      cacheWrite: 6,
    };
    expect(
      computeCostUsd(explicit, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.5, 9);
  });

  it("costs 0 for null rates but does not throw", () => {
    expect(
      computeCostUsd(null, { inputTokens: 1000, outputTokens: 1000 }),
    ).toBe(0);
  });
});

describe("ratesForModel", () => {
  it("serves the seeded floor for a known model", () => {
    expect(ratesForModel("claude-sonnet-5")).toEqual({
      input: 3,
      output: 15,
      cacheRead: null,
      cacheWrite: null,
    });
  });

  it("returns null for an unknown model", () => {
    expect(ratesForModel("kimi-k2")).toBeNull();
  });
});

describe("costToCredits", () => {
  it("converts 1 USD to 100 credits", () => {
    expect(costToCredits(1)).toBe(100);
  });
});
