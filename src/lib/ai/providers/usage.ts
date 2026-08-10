import type { LanguageModelUsage } from "ai";
import type { AiUsageTokens } from "@/lib/ai/pricing";

/**
 * Translate one AI SDK usage object into the metering shape `computeCostUsd`
 * bills against. ONE place, because every adapter needs it and getting it
 * wrong mis-bills every AI call in the product.
 *
 * THE TRAP: `LanguageModelUsage.inputTokens` is the TOTAL input — cached reads
 * and cache writes INCLUDED. Every provider package computes it that way
 * (`inputTokens.total = noCache + cacheRead + cacheWrite`; see
 * `convertAnthropicUsage`, and the OpenAI/Google equivalents). But
 * `AiUsageTokens.inputTokens` means the UNCACHED input, because
 * `computeCostUsd` prices cache reads (0.1x) and cache writes (1.25x)
 * SEPARATELY and adds them on top. Passing the SDK's `inputTokens` straight
 * through therefore charges every cached token twice — once at the full input
 * rate and again at its cache multiplier. `inputTokenDetails.noCacheTokens` is
 * the field that means what we mean.
 *
 * Note this is also why the AI SDK has no `cachedInputTokens` field: cache
 * counts are under `inputTokenDetails`, and cache WRITES are first-class there
 * rather than hiding in `providerMetadata.anthropic`.
 */
export function toAiUsage(
  usage: LanguageModelUsage | undefined,
): AiUsageTokens {
  const details = usage?.inputTokenDetails;
  const cacheReadTokens = details?.cacheReadTokens ?? 0;
  const cacheWriteTokens = details?.cacheWriteTokens ?? 0;
  // Prefer the explicit uncached count; derive it only when a provider left it
  // undefined, and never let the subtraction go negative.
  const inputTokens =
    details?.noCacheTokens ??
    Math.max(0, (usage?.inputTokens ?? 0) - cacheReadTokens - cacheWriteTokens);
  return {
    inputTokens,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens,
    cacheWriteTokens,
  };
}
