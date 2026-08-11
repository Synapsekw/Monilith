import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import OpenAI from "openai";
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

// There is deliberately NO module-level model constant here. The old
// `const MODEL = "gpt-4o"` meant this adapter ignored the model it was asked
// for and ran gpt-4o instead — the regression this layer exists to close.

export const openaiAdapter: ProviderAdapter = {
  kind: "openai",

  async validateKey({ apiKey }) {
    const client = new OpenAI({ apiKey });
    try {
      await client.models.list();
    } catch (e) {
      if (e instanceof OpenAI.AuthenticationError)
        throw new ProviderAuthError("openai");
      throw e;
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
    const provider = createOpenAI({ apiKey, fetch: client?.fetch });
    const res = await generateObjectFn(client)({
      model: provider(model),
      schema: toSdkSchema(schema),
      system,
      prompt: user,
      providerOptions: {
        // OpenAI's STRICT structured outputs reject `oneOf`, which
        // PROPOSAL_JSON_SCHEMA uses to specify each widget kind's config.
        // Non-strict still sends the schema (far better than the old
        // embed-it-in-the-prompt JSON mode) and every caller re-validates the
        // result downstream anyway.
        openai: { strictJsonSchema: false },
      },
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
