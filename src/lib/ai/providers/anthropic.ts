import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { z } from "zod";
import { MODEL } from "@/lib/ai/anthropic";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
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
  async generateProposal({ apiKey, system, user }) {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: jsonSchemaOutputFormat(PROPOSAL_JSON_SCHEMA as never),
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
      proposal: parsed as DashboardProposal,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  },
};
