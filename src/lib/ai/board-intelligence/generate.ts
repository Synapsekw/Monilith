import "server-only";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import { toRequestArgs } from "@/lib/ai/providers/request";
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
      ...toRequestArgs(opts),
      system: systemPrompt(),
      user: buildUserPrompt(input),
      schema: BOARD_INTELLIGENCE_JSON_SCHEMA,
    },
  );
  return { raw: data, usage, model };
}
