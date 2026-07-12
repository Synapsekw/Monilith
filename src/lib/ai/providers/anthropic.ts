import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { z } from "zod";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import { PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";
import {
  ProviderAuthError,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

/** The Anthropic model powering AI dashboard generation and Ask Pulse.
 *  Single source of truth (google/openai adapters keep their own). */
export const MODEL = "claude-opus-4-8";

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: PROVIDER_CATALOG.anthropic.label,
  placeholder: PROVIDER_CATALOG.anthropic.placeholder,
  keyFormat: z
    .string()
    .trim()
    .startsWith("sk-ant-", "Anthropic keys start with sk-ant-")
    .max(300),
  defaultModel: MODEL,
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
  async generateStructured({ apiKey, system, user, schema }) {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
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
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  },
  async generateProposal({ apiKey, system, user }) {
    const { data, usage } = await this.generateStructured({
      apiKey,
      system,
      user,
      schema: PROPOSAL_JSON_SCHEMA,
    });
    return { proposal: data as DashboardProposal, usage };
  },
};
