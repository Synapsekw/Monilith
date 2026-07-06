import "server-only";
import OpenAI from "openai";
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

const MODEL = "gpt-4o";

// OpenAI structured outputs reject `oneOf` (used in PROPOSAL_JSON_SCHEMA), so we
// use plain JSON mode and embed the schema in the prompt. validateProposal()
// downstream repairs/drops any widget that drifts.
function withSchema(user: string): string {
  return `${user}\n\nReturn ONLY a JSON object matching this JSON Schema (no prose):\n${JSON.stringify(
    PROPOSAL_JSON_SCHEMA,
  )}`;
}

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
    return JSON.parse(
      res.choices[0]?.message.content ?? "{}",
    ) as DashboardProposal;
  },
};
