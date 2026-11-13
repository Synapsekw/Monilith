import "server-only";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { requestShapeFor, type ThinkingConfig } from "@/lib/ai/model-map";

/**
 * `ThinkingConfig` uses the RAW Anthropic wire shape (`budget_tokens`);
 * `providerOptions.anthropic.thinking` uses the AI SDK's camelCase
 * (`budgetTokens`). The SDK's zod schema strips unknown keys, so handing it
 * `budget_tokens` would silently drop the budget and send `{ type: "enabled" }`
 * with no budget at all — which Anthropic rejects. Translate explicitly.
 */
export function toSdkThinking(thinking: ThinkingConfig | undefined) {
  if (!thinking) return undefined;
  return thinking.type === "adaptive"
    ? { type: "adaptive" as const }
    : { type: "enabled" as const, budgetTokens: thinking.budget_tokens };
}

/**
 * The repo's per-model request shape (`requestShapeFor`) as AI SDK Anthropic
 * provider options, for a call that drives `streamText`/`generateText`
 * directly. Without it the SDK sends no `thinking` block at all. `effort` is
 * omitted, not sent as undefined, for models whose shape leaves it out
 * (Haiku 4.5 rejects the key).
 */
export function anthropicReasoningOptions(model: string) {
  const shape = requestShapeFor(model);
  const thinking = toSdkThinking(shape.thinking);
  // `satisfies`, not a return annotation: the SDK's options type includes
  // fields that are not JSON-typed, so annotating with it would not assign to
  // `providerOptions`. This keeps the literal checked against the SDK's own
  // schema type while its inferred type stays JSON-shaped.
  const anthropic = {
    ...(thinking ? { thinking } : {}),
    ...(shape.effort ? { effort: shape.effort } : {}),
  } satisfies AnthropicLanguageModelOptions;
  return { anthropic };
}
