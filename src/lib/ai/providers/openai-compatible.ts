import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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
import { MODEL_LIST_TIMEOUT_MS } from "@/lib/ai/models/verify-ids";

/**
 * ONE adapter for every OpenAI-compatible provider. Mistral and Kimi both run
 * on it today, and every provider added later without a deploy rides it too —
 * the only thing that differs between them is `baseUrl`, which comes from the
 * `ai_providers` row. That is why the tests assert baseUrl is honoured.
 */

/**
 * The SDK derives its providerOptions namespace from this name
 * (`config.provider.split(".")[0]`), so the two uses below must agree — a
 * mismatched key is silently spread into the request body instead of being
 * read as an option.
 */
const PROVIDER_NAME = "byo";

function requireBaseUrl(baseUrl: string | null): string {
  if (!baseUrl)
    throw new Error(
      "openai-compatible adapter requires a baseUrl from its ai_providers row",
    );
  return baseUrl;
}

export const openaiCompatibleAdapter: ProviderAdapter = {
  kind: "openai-compatible",

  async validateKey({ apiKey, baseUrl }) {
    const url = `${requireBaseUrl(baseUrl).replace(/\/$/, "")}/models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // This call sits on a Server Action's response path (`saveAiKey`,
      // `setOrgByoKey`), so a provider that accepts the connection and then
      // stalls holds the user's "Validate & save" open for undici's default
      // — minutes. The deadline is the SAME budget `listNativeModelIds` puts
      // on the same `/models` endpoint, deliberately shared rather than
      // restated, so the two cannot drift.
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403)
      throw new ProviderAuthError(baseUrl ?? "provider");
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);
  },

  async generateStructured<T>({
    apiKey,
    baseUrl,
    model,
    system,
    user,
    schema,
    client,
  }: GenerateArgs) {
    const provider = createOpenAICompatible({
      name: PROVIDER_NAME,
      baseURL: requireBaseUrl(baseUrl),
      apiKey,
      fetch: client?.fetch,
      // The SDK defaults this to FALSE, and with it false the JSON schema is
      // dropped from the request entirely (it only warns) — a
      // structured-output adapter that sends no schema. Both seeded providers
      // on this wire format (Mistral, Kimi) accept OpenAI's
      // `response_format: { type: "json_schema" }`, which is the whole point
      // of calling a provider "OpenAI-compatible".
      supportsStructuredOutputs: true,
    });
    const res = await generateObjectFn(client)({
      // `model` is the resolved catalog id — never a hardcoded default.
      model: provider(model),
      schema: toSdkSchema(schema),
      system,
      prompt: user,
      providerOptions: {
        // Same reason as the OpenAI adapter: strict mode rejects `oneOf`,
        // which PROPOSAL_JSON_SCHEMA uses. Callers re-validate regardless.
        [PROVIDER_NAME]: { strictJsonSchema: false },
      },
    });
    return {
      data: res.object as T,
      // Report what actually ran; runAi meters this value.
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
