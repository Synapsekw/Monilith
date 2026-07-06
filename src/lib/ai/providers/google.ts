import "server-only";
import { GoogleGenAI } from "@google/genai";
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

const MODEL = "gemini-2.0-flash";

function withSchema(user: string): string {
  return `${user}\n\nReturn ONLY a JSON object matching this JSON Schema (no prose):\n${JSON.stringify(
    PROPOSAL_JSON_SCHEMA,
  )}`;
}

export const googleAdapter: ProviderAdapter = {
  id: "google",
  label: PROVIDER_CATALOG.google.label,
  placeholder: PROVIDER_CATALOG.google.placeholder,
  keyFormat: z.string().trim().min(20).max(300),
  defaultModel: MODEL,
  async validateKey(rawKey) {
    const ai = new GoogleGenAI({ apiKey: rawKey });
    try {
      // Cheapest authenticated call — a bad key throws (400/403 "API key not valid").
      await ai.models.list({ config: { pageSize: 1 } });
    } catch {
      throw new ProviderAuthError("google");
    }
  },
  async generateProposal({ apiKey, system, user }) {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: withSchema(user) }] }],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
      },
    });
    return JSON.parse(res.text ?? "{}") as DashboardProposal;
  },
};
