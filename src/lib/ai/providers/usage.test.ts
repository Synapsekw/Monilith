import { describe, expect, it } from "vitest";
import type { LanguageModelUsage } from "ai";
import { computeCostUsd } from "@/lib/ai/pricing";
import { toAiUsage } from "@/lib/ai/providers/usage";

function usage(over: Partial<LanguageModelUsage>): LanguageModelUsage {
  return {
    inputTokens: undefined,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: undefined,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    totalTokens: undefined,
    ...over,
  } as LanguageModelUsage;
}

describe("toAiUsage", () => {
  it("reads the UNCACHED input count, not the SDK's cache-inclusive total", () => {
    // This is the whole point of the module. Every AI SDK provider reports
    // `inputTokens` as noCache + cacheRead + cacheWrite, while our metering
    // shape means input EXCLUDING cache (computeCostUsd adds cache back at its
    // own multipliers). Passing the total through double-bills every cached
    // token.
    const res = toAiUsage(
      usage({
        inputTokens: 10_000,
        inputTokenDetails: {
          noCacheTokens: 1_000,
          cacheReadTokens: 8_000,
          cacheWriteTokens: 1_000,
        },
        outputTokens: 500,
      }),
    );
    expect(res).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 8_000,
      cacheWriteTokens: 1_000,
    });
  });

  it("bills a cache-heavy call at the cached rate, not ~9x it", () => {
    // The regression stated in money. Sonnet 5 is $3/Mtok in, $15/Mtok out.
    const metered = toAiUsage(
      usage({
        inputTokens: 10_000,
        inputTokenDetails: {
          noCacheTokens: 1_000,
          cacheReadTokens: 9_000,
          cacheWriteTokens: 0,
        },
        outputTokens: 0,
      }),
    );
    // 1_000 * $3 + 9_000 * $3 * 0.1 = $0.003 + $0.0027 per Mtok basis.
    expect(computeCostUsd("claude-sonnet-5", metered)).toBeCloseTo(
      (1_000 * 3 + 9_000 * 3 * 0.1) / 1_000_000,
      12,
    );
    // Had we passed `inputTokens` straight through it would be 10_000 * $3
    // PLUS the same cache-read charge — 3.7x the true cost.
    const naive = { ...metered, inputTokens: 10_000 };
    expect(computeCostUsd("claude-sonnet-5", naive)).toBeGreaterThan(
      computeCostUsd("claude-sonnet-5", metered),
    );
  });

  it("derives the uncached count when a provider omits noCacheTokens", () => {
    const res = toAiUsage(
      usage({
        inputTokens: 100,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: 30,
          cacheWriteTokens: 10,
        },
        outputTokens: 5,
      }),
    );
    expect(res.inputTokens).toBe(60);
  });

  it("never returns a negative input count", () => {
    const res = toAiUsage(
      usage({
        inputTokens: 10,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: 40,
          cacheWriteTokens: 0,
        },
      }),
    );
    expect(res.inputTokens).toBe(0);
  });

  it("falls back to zeroes when the provider reports no usage at all", () => {
    expect(toAiUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});
