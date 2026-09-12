import "server-only";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import { toRequestArgs, withEffort } from "@/lib/ai/providers/request";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { buildUserPrompt, systemPrompt, type PromptInput } from "./prompt";
import { BOARD_INTELLIGENCE_JSON_SCHEMA } from "./schema";

/** One structured call through the provider adapter (provider-portable — no
 *  Anthropic-direct client, no tool loop). `opts.model` is the WIRE id
 *  (`ResolvedModel.requestModel`); runAi meters the catalog id itself. */
export async function generateBoardIntelligence(
  input: PromptInput,
  opts: {
    adapter: ProviderAdapter;
    apiKey: string;
    baseUrl?: string | null;
    model: string;
  },
): Promise<{ raw: unknown; usage: AiUsageTokens; model: string }> {
  const { data, usage, model } = await opts.adapter.generateStructured<unknown>(
    {
      // MUST be explicit. `toRequestArgs` hands a Sonnet/Opus-tier model
      // DEFAULT_SHAPE — adaptive thinking at effort "high" — and the first real
      // run billed 5284 output tokens for a stored payload of ~700: about 85%
      // of both the cost and the ~2-minute wait was reasoning nobody chose.
      // This is a foreground action the user is watching, which is exactly the
      // shape of route that does not repay high effort.
      //
      // The knob is `effort`, NOT `thinking: { type: "disabled" }`. Turning
      // thinking off is a 400 on Claude Fable 5/5.1 — both ACTIVE rows in the
      // model catalog, and `pickModel` puts an org's default model above the
      // feature's tier hint, so one admin choosing Fable in Settings would make
      // every run fail. See `withEffort` for the rest of the reasoning.
      //
      // "low" rather than "medium" because degradation here is VISIBLE:
      // `validateIntelligenceOutput` drops any suggestion not grounded in a
      // real item id and logs "[intelligence] dropped suggestions". If that
      // line starts appearing, step up to "medium" — don't guess by feel.
      ...withEffort(toRequestArgs(opts), "low"),
      system: systemPrompt(),
      user: buildUserPrompt(input),
      schema: BOARD_INTELLIGENCE_JSON_SCHEMA,
    },
  );
  return { raw: data, usage, model };
}
