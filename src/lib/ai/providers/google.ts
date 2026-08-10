import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { GoogleGenAI } from "@google/genai";
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

// As in openai.ts: the old `const MODEL = "gemini-2.0-flash"` is gone. This
// adapter runs the model it is handed.

export const googleAdapter: ProviderAdapter = {
  kind: "google",

  async validateKey({ apiKey }) {
    const ai = new GoogleGenAI({ apiKey });
    try {
      // Cheapest authenticated call — a bad key throws (400/403 "API key not
      // valid"). The catch-all is deliberate: the Google SDK exposes no typed
      // auth error to narrow on.
      await ai.models.list({ config: { pageSize: 1 } });
    } catch {
      throw new ProviderAuthError("google");
    }
  },

  async generateStructured<T>({
    apiKey,
    model,
    system,
    user,
    schema,
    client,
  }: GenerateArgs) {
    const provider = createGoogleGenerativeAI({ apiKey, fetch: client?.fetch });
    const res = await generateObjectFn(client)({
      model: provider(model),
      schema: toSdkSchema(schema),
      system,
      prompt: user,
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
