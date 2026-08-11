import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelMessage } from "ai";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import { generateObjectFn, toSdkSchema } from "@/lib/ai/providers/sdk";
import {
  ProviderAuthError,
  type GenerateArgs,
  type ProviderAdapter,
  type ThinkingConfig,
} from "@/lib/ai/providers/types";
import { toAiUsage } from "@/lib/ai/providers/usage";

/** Matches today's `max_tokens: 16000`. */
const MAX_OUTPUT_TOKENS = 16000;

/**
 * `ThinkingConfig` uses the RAW Anthropic wire shape (`budget_tokens`);
 * `providerOptions.anthropic.thinking` uses the AI SDK's camelCase
 * (`budgetTokens`). The SDK's zod schema strips unknown keys, so handing it
 * `budget_tokens` would silently drop the budget and send `{ type: "enabled" }`
 * with no budget at all — which Anthropic rejects. Translate explicitly.
 */
function toSdkThinking(thinking: ThinkingConfig | undefined) {
  if (!thinking) return undefined;
  return thinking.type === "adaptive"
    ? { type: "adaptive" as const }
    : { type: "enabled" as const, budgetTokens: thinking.budget_tokens };
}

export const anthropicAdapter: ProviderAdapter = {
  kind: "anthropic",

  async validateKey({ apiKey }) {
    const client = new Anthropic({ apiKey });
    try {
      await client.models.list({ limit: 1 });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError)
        throw new ProviderAuthError("anthropic");
      throw e;
    }
  },

  async generateStructured<T>({
    apiKey,
    model,
    system,
    user,
    schema,
    thinking,
    effort,
    client,
  }: GenerateArgs) {
    const provider = createAnthropic({ apiKey, fetch: client?.fetch });
    const sdkThinking = toSdkThinking(thinking);
    // The system prompt is frozen per feature, so it is the cache prefix. Sent
    // as an explicit system MESSAGE rather than the `system` string because
    // `cache_control` can only be attached via a message's providerOptions —
    // dropping it would silently end prompt caching and multiply input COGS.
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: system,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      { role: "user", content: user },
    ];
    const res = await generateObjectFn(client)({
      model: provider(model),
      schema: toSdkSchema(schema),
      messages,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: {
        anthropic: {
          ...(sdkThinking ? { thinking: sdkThinking } : {}),
          // Haiku 4.5 rejects `effort` — omit the key entirely rather than
          // sending undefined, which would still serialize.
          ...(effort ? { effort } : {}),
        },
      },
    });
    return {
      data: res.object as T,
      model,
      usage: toAiUsage(res.usage),
    };
  },

  async generateProposal(args) {
    const { data, usage, model } = await this.generateStructured({
      ...args,
      schema: PROPOSAL_JSON_SCHEMA,
    });
    return { proposal: data as DashboardProposal, usage, model };
  },
};
