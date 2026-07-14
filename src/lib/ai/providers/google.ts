import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { type DashboardProposal } from "@/lib/ai/proposal-schema";
import { PROVIDER_CATALOG } from "@/lib/ai/providers/catalog";
import { withSchemaObject } from "@/lib/ai/providers/prompt";
import { PROPOSAL_JSON_SCHEMA } from "@/lib/ai/proposal-schema";
import {
  ProviderAuthError,
  type ProviderAdapter,
} from "@/lib/ai/providers/types";

const MODEL = "gemini-2.0-flash";

export const googleAdapter: ProviderAdapter = {
  id: "google",
  label: PROVIDER_CATALOG.google.label,
  placeholder: PROVIDER_CATALOG.google.placeholder,
  keyFormat: z
    .string()
    .trim()
    .startsWith("AIza", "Google API keys start with AIza")
    .max(300),
  defaultModel: MODEL,
  supportsTools: false,
  async validateKey(rawKey) {
    const ai = new GoogleGenAI({ apiKey: rawKey });
    try {
      // Cheapest authenticated call — a bad key throws (400/403 "API key not valid").
      await ai.models.list({ config: { pageSize: 1 } });
    } catch {
      throw new ProviderAuthError("google");
    }
  },
  async generateStructured({ apiKey, system, user, schema }) {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { role: "user", parts: [{ text: withSchemaObject(user, schema) }] },
      ],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
      },
    });
    return {
      data: JSON.parse(res.text ?? "{}"),
      usage: {
        inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
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
