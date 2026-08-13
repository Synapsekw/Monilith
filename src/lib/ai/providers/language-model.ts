import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { AdapterKind } from "@/lib/ai/providers/provider-rows";
import { PROVIDER_NAME } from "@/lib/ai/providers/openai-compatible";

/**
 * A `LanguageModel` instance for one resolved provider + model, keyed by WIRE
 * FORMAT exactly like `getAdapter`.
 *
 * WHY THIS IS NOT ON `ProviderAdapter`. That interface is the
 * STRUCTURED-OUTPUT seam: `generateStructured` / `generateProposal`, both of
 * which own their own prompt shape, their own `maxOutputTokens`, and their own
 * `providerOptions`. The agent run needs the opposite — a bare model handed to
 * `generateText` so the AI SDK can drive a multi-step tool loop over it. Adding
 * a `languageModel()` method to every adapter would mean each adapter owning a
 * one-line factory it does not otherwise use, so the factory lives here and the
 * adapters stay about structured output.
 *
 * `model` MUST be the WIRE id (`ResolvedModel.requestModel`), never the catalog
 * key: the Gateway publishes `claude-haiku-4.5` where Anthropic's own API wants
 * `claude-haiku-4-5-20251001`, and sending the key is a 404 — a scheduled agent
 * that silently stops producing.
 */
export function languageModelFor(args: {
  kind: AdapterKind;
  apiKey: string;
  /** Non-null exactly for the openai-compatible kind, from its provider row. */
  baseUrl: string | null;
  /** The WIRE model id. */
  model: string;
}): LanguageModel {
  const { kind, apiKey, baseUrl, model } = args;
  switch (kind) {
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "openai":
      return createOpenAI({ apiKey })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model);
    case "openai-compatible": {
      if (!baseUrl)
        throw new Error(
          "languageModelFor: the openai-compatible kind requires a baseUrl " +
            "from its ai_providers row",
        );
      // The name decides the `providerOptions` namespace the SDK reads
      // (`config.provider.split(".")[0]`). IMPORTED from the adapter rather
      // than restated, so an option set for one path can never be silently
      // ignored on the other — the mismatch does not error, it is spread into
      // the request body and dropped.
      return createOpenAICompatible({
        name: PROVIDER_NAME,
        baseURL: baseUrl,
        apiKey,
      })(model);
    }
  }
}
