import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { type DashboardProposal } from "@/lib/ai/proposal-schema";
import { PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";
import { withSchemaObject } from "@/lib/ai/providers/prompt";
import { PROPOSAL_JSON_SCHEMA } from "@/lib/ai/proposal-schema";
import {
  ProviderAuthError,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

// OpenAI structured outputs reject `oneOf` (used in PROPOSAL_JSON_SCHEMA), so we
// use plain JSON mode and embed the schema in the prompt (see withSchema).
// validateProposal() downstream repairs/drops any widget that drifts.
const MODEL = "gpt-4o";

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: PROVIDER_CATALOG.openai.label,
  placeholder: PROVIDER_CATALOG.openai.placeholder,
  keyFormat: z
    .string()
    .trim()
    .startsWith("sk-", "OpenAI keys start with sk-")
    .max(300),
  defaultModel: MODEL,
  supportsTools: false,
  async validateKey(rawKey) {
    const client = new OpenAI({ apiKey: rawKey });
    try {
      await client.models.list();
    } catch (e) {
      if (e instanceof OpenAI.AuthenticationError)
        throw new ProviderAuthError("openai");
      throw e;
    }
  },
  async generateStructured({ apiKey, system, user, schema }) {
    const client = new OpenAI({ apiKey });
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: withSchemaObject(user, schema) },
      ],
      response_format: { type: "json_object" },
    });
    return {
      data: JSON.parse(res.choices[0]?.message.content ?? "{}"),
      // NOT choice.model — this adapter ignores `choice` and always runs MODEL.
      // Reporting anything else mis-bills a BYO org (see ProviderAdapter docs).
      model: MODEL,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
    };
  },
  async generateProposal({ apiKey, system, user }) {
    const { data, usage, model } = await this.generateStructured({
      apiKey,
      system,
      user,
      schema: PROPOSAL_JSON_SCHEMA,
    });
    return { proposal: data as DashboardProposal, usage, model };
  },
};
