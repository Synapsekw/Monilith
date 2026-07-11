import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { type DashboardProposal } from "@/lib/ai/proposal-schema";
import { PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";
import { withSchema } from "@/lib/ai/providers/prompt";
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
  async generateProposal({ apiKey, system, user }) {
    const client = new OpenAI({ apiKey });
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: withSchema(user) },
      ],
      response_format: { type: "json_object" },
    });
    return {
      proposal: JSON.parse(
        res.choices[0]?.message.content ?? "{}",
      ) as DashboardProposal,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
    };
  },
};
