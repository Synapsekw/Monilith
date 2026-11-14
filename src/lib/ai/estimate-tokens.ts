/**
 * ~4 characters per token. Crude, provider-independent, and deliberately the
 * only estimator in the codebase.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
