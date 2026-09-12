import { requestShapeFor, type Effort } from "@/lib/ai/model-map";
import type { GenerateArgs } from "@/lib/ai/providers/types";

type RequestArgs = Pick<
  GenerateArgs,
  "apiKey" | "baseUrl" | "model" | "thinking" | "effort"
>;

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
}): RequestArgs {
  const shape = requestShapeFor(opts.model);
  return {
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? null,
    model: opts.model,
    thinking: shape.thinking,
    effort: shape.effort,
  };
}

/**
 * Lower (or raise) the reasoning effort for ONE feature, without touching the
 * model-shape seam that decides whether the knob exists at all.
 *
 * `effort` is the portable way to spend fewer thinking tokens. Turning thinking
 * off outright is NOT portable and must not be done here: Claude Fable 5/5.1
 * reject `thinking: { type: "disabled" }` with a 400 outright, and Opus 5
 * accepts it only at effort "high" or below — and even there, disabling
 * thinking is documented to make the model occasionally write a tool call into
 * its visible text and leak `<thinking>` tags. Lowering effort is the remedy
 * Anthropic actually recommends, and it works on every family we route to.
 *
 * A feature must never set `effort` unconditionally: Haiku 4.5 rejects the key,
 * which is exactly why `requestShapeFor` leaves it undefined there. So this
 * overrides the LEVEL only where the model already accepts the knob, and leaves
 * the key absent otherwise.
 */
export function withEffort(args: RequestArgs, effort: Effort): RequestArgs {
  return args.effort === undefined ? args : { ...args, effort };
}
