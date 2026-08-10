import { DEFAULT_MODEL_CHOICE, type ModelChoice } from "@/lib/ai/model-map";
import type { GenerateArgs } from "@/lib/ai/providers/types";

/**
 * Flatten the per-feature `ModelChoice` into the adapter's request arguments.
 *
 * `ProviderAdapter` takes `model` / `thinking` / `effort` as separate fields
 * rather than a `ModelChoice`, because a `ModelChoice` is an ANTHROPIC-shaped
 * request config and three of the four adapters have no use for its knobs —
 * but every adapter must be told, unambiguously, which model to run. This is
 * the one place that bridge is written.
 *
 * The `DEFAULT_MODEL_CHOICE` fallback preserves today's behaviour for the
 * handful of callers that pass no choice at all; `resolveModel` (Task 7)
 * replaces it with a catalog lookup.
 */
export function toRequestArgs(opts: {
  apiKey: string;
  /** Non-null only for openai-compatible providers; threaded in Task 8. */
  baseUrl?: string | null;
  choice?: ModelChoice;
}): Pick<GenerateArgs, "apiKey" | "baseUrl" | "model" | "thinking" | "effort"> {
  const choice = opts.choice ?? DEFAULT_MODEL_CHOICE;
  return {
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? null,
    model: choice.model,
    thinking: choice.thinking,
    effort: choice.effort,
  };
}
