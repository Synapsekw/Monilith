export type AiUsageTokens = {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache hits. Billed at 0.10x the model's input rate. */
  cacheReadTokens?: number;
  /** Prompt-cache writes. Billed at 1.25x the model's input rate. */
  cacheWriteTokens?: number;
};

/** Anthropic-wide cache multipliers, applied to each model's input rate. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * USD per million tokens, by model id. Source of truth for metering.
 * Maintain alongside the provider catalog when models change.
 *
 * Sonnet 5 is listed at its STANDARD $3/$15, not the introductory $2/$10 that
 * expires 2026-08-31 — under-stating our own cost would over-charge customer
 * credits and create a cliff when the intro rate ends.
 */
const MODEL_PRICES_PER_MTOK: Readonly<
  Record<string, Readonly<{ input: number; output: number }>>
> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  // Fixed platform embedding model (E5 · F15). Input-only: embeddings emit no
  // completion tokens, so output is 0 and computeCostUsd is input-only arithmetic.
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

/** Every model id the model map may emit must be priced here. */
export const PRICED_MODELS = Object.keys(MODEL_PRICES_PER_MTOK);

/** Cost in USD for one call. Unknown models cost 0 (tokens are still logged). */
export function computeCostUsd(model: string, usage: AiUsageTokens): number {
  const price = MODEL_PRICES_PER_MTOK[model];
  if (!price) return 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      cacheRead * price.input * CACHE_READ_MULTIPLIER +
      cacheWrite * price.input * CACHE_WRITE_MULTIPLIER) /
    1_000_000
  );
}

/** 1 credit = $0.01, rounded to 2 decimal places. */
export function costToCredits(costUsd: number): number {
  // USD → credits (×100), then round to 2dp
  return Math.round(costUsd * 10000) / 100;
}
