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
 * changes the LEVEL only, and never introduces the key where the shape omitted
 * it.
 *
 * Be precise about what that buys you: the guard is "the shape left `effort`
 * undefined", and `requestShapeFor` decides that from `/haiku/i` alone — which
 * is NOT the same fact as "this model accepts effort". `ai_models` currently
 * has active non-Haiku rows that reject the key outright (`claude-sonnet-4.5`,
 * `claude-sonnet-4`, `claude-opus-4`) and one that rejects adaptive thinking
 * (`claude-opus-4.5`, pre-4.6). Those already 400 on `develop` via
 * DEFAULT_SHAPE, for every adapter-routed feature — this helper neither causes
 * nor fixes it. The real repair is per-model shaping in `model-map.ts`; see
 * gotcha-104. Do not read this guard as model-safety it does not provide.
 */
export function withEffort(args: RequestArgs, effort: Effort): RequestArgs {
  return args.effort === undefined ? args : { ...args, effort };
}
