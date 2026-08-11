import { requestShapeFor } from "@/lib/ai/model-map";
import type { GenerateArgs } from "@/lib/ai/providers/types";

/**
 * Flatten a resolved model into the adapter's request arguments.
 *
 * `ProviderAdapter` takes `model` / `thinking` / `effort` as separate fields
 * rather than one config object, because `thinking`/`effort` are
 * ANTHROPIC-shaped knobs that three of the four adapters have no use for — but
 * every adapter must be told, unambiguously, which model to run. This is the
 * one place that bridge is written.
 *
 * `model` is REQUIRED and is the WIRE id (`ResolvedModel.requestModel`), never
 * the catalog key. It used to be optional with a hardcoded `claude-sonnet-5`
 * fallback, which is precisely how a non-Anthropic org ended up asking its
 * provider for a Claude model.
 */
export function toRequestArgs(opts: {
  apiKey: string;
  /** Non-null only for openai-compatible providers. */
  baseUrl?: string | null;
  model: string;
}): Pick<GenerateArgs, "apiKey" | "baseUrl" | "model" | "thinking" | "effort"> {
  const shape = requestShapeFor(opts.model);
  return {
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? null,
    model: opts.model,
    thinking: shape.thinking,
    effort: shape.effort,
  };
}
