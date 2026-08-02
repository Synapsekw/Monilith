import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { z } from "zod";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import { DEFAULT_MODEL_CHOICE } from "@/lib/ai/model-map";
import { PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";
import {
  ProviderAuthError,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: PROVIDER_CATALOG.anthropic.label,
  placeholder: PROVIDER_CATALOG.anthropic.placeholder,
  keyFormat: z
    .string()
    .trim()
    .startsWith("sk-ant-", "Anthropic keys start with sk-ant-")
    .max(300),
  defaultModel: DEFAULT_MODEL_CHOICE.model,
  supportsTools: true,
  async validateKey(rawKey) {
    const client = new Anthropic({ apiKey: rawKey });
    try {
      await client.models.list({ limit: 1 });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError)
        throw new ProviderAuthError("anthropic");
      throw e;
    }
  },
  async generateStructured({ apiKey, system, user, schema, choice, client }) {
    const c = (client as Anthropic) ?? new Anthropic({ apiKey });
    const m = choice ?? DEFAULT_MODEL_CHOICE;
    const message = await c.messages.parse({
      model: m.model,
      max_tokens: 16000,
      thinking: m.thinking,
      output_config: {
        // Haiku 4.5 rejects `effort` — omit the key entirely rather than
        // sending undefined, which the SDK would still serialize.
        ...(m.effort ? { effort: m.effort } : {}),
        format: jsonSchemaOutputFormat(schema as never),
      },
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: user }],
    });
    const textBlock = message.content.find((b) => b.type === "text");
    const parsed =
      (message as { parsed_output?: unknown }).parsed_output ??
      JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}");
    return {
      data: parsed,
      model: m.model,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  },
  async generateProposal({ apiKey, system, user, choice, client }) {
    const { data, usage, model } = await this.generateStructured({
      apiKey,
      system,
      user,
      schema: PROPOSAL_JSON_SCHEMA,
      choice,
      client,
    });
    return { proposal: data as DashboardProposal, usage, model };
  },
};
