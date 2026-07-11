export type AiUsageTokens = { inputTokens: number; outputTokens: number };

/**
 * USD per million tokens, by model id. Source of truth for metering.
 * Maintain alongside the provider catalog when models change.
 */
export const MODEL_PRICES_PER_MTOK: Readonly<
  Record<string, Readonly<{ input: number; output: number }>>
> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

/** Cost in USD for one call. Unknown models cost 0 (tokens are still logged). */
export function computeCostUsd(model: string, usage: AiUsageTokens): number {
  const price = MODEL_PRICES_PER_MTOK[model];
  if (!price) return 0;
  return (
    (usage.inputTokens * price.input + usage.outputTokens * price.output) /
    1_000_000
  );
}

/** 1 credit = $0.01, rounded to 2 decimal places. */
export function costToCredits(costUsd: number): number {
  // USD → credits (×100), then round to 2dp
  return Math.round(costUsd * 10000) / 100;
}
