import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { GoogleGenAI } from "@google/genai";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import { withSchemaObject } from "@/lib/ai/providers/prompt";
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
      // Still passed: this is what parses and types the response. Only the
      // PROVIDER-side copy is suppressed below.
      schema: toSdkSchema(schema),
      system,
      // Gemini's `responseSchema` is an OpenAPI-3.0 subset with no `oneOf`,
      // and @ai-sdk/google forwards `oneOf` verbatim
      // (convertJSONSchemaToOpenAPISchema), so the request 400s for the two
      // schemas that use it — PROPOSAL_JSON_SCHEMA (dashboard_gen) and
      // AUTOMATION_DRAFT_JSON_SCHEMA (automation_gen). `structuredOutputs:
      // false` is the SDK's own documented escape hatch for exactly this, but
      // it drops `responseSchema` ENTIRELY (keeping only
      // responseMimeType: application/json) — so on its own it would leave the
      // model with no schema at all, weaker than the adapter this replaces.
      // Embedding the schema in the prompt restores that prior behaviour, and
      // the pair together is what the old adapter did. Applied uniformly
      // rather than sniffing each schema for `oneOf`: one predictable path
      // beats two, and a 400 is a hard user-facing failure.
      prompt: withSchemaObject(user, schema),
      providerOptions: { google: { structuredOutputs: false } },
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
