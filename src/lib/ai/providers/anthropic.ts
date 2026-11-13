import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelMessage, SystemModelMessage } from "ai";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import { generateObjectFn, toSdkSchema } from "@/lib/ai/providers/sdk";
import {
  ProviderAuthError,
  type GenerateArgs,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";
import { toAiUsage } from "@/lib/ai/providers/usage";
import { toSdkThinking } from "@/lib/ai/providers/anthropic-options";

/** Matches today's `max_tokens: 16000`. */
const MAX_OUTPUT_TOKENS = 16000;

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
    // as a system MESSAGE (not a bare string) because `cache_control` can only
    // be attached via a message's providerOptions — dropping it would silently
    // end prompt caching and multiply input COGS. It rides `instructions`, not
    // `messages`: since ai@7.0.92 `standardizePrompt` rejects a system role
    // inside `messages` ("Use the instructions option instead"), and the SDK
    // maps an instructions message to the top-level `system` block WITH its
    // providerOptions intact (convertToLanguageModelPrompt).
    const instructions: SystemModelMessage[] = [
      {
        role: "system",
        content: system,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
    ];
    const messages: ModelMessage[] = [{ role: "user", content: user }];
    const res = await generateObjectFn(client)({
      model: provider(model),
      schema: toSdkSchema(schema),
      instructions,
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
