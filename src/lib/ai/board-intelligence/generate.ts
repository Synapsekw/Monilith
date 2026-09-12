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
      // MUST be explicit. `toRequestArgs` hands a Sonnet/Opus-tier model
      // DEFAULT_SHAPE — adaptive thinking at effort "high" — and the first
      // real run billed 5284 output tokens for a stored payload of ~700: about
      // 85% of both the cost and the ~2-minute wait was extended thinking
      // nobody chose. Unlike the other features that disable it, the reason
      // here is NOT a tight max_tokens (the adapter allows 16000) — it is
      // latency on a foreground, user-initiated action.
      //
      // Disabled rather than a small budget because degradation is VISIBLE:
      // `validateIntelligenceOutput` drops any suggestion that isn't grounded
      // in a real item id and logs "[intelligence] dropped suggestions", so a
      // thinking-off model that grounds worse announces itself in the logs
      // instead of quietly shipping a worse brief. `effort` is deliberately
      // left on the model's own shape — it is an output_config knob, and Haiku
      // rejects the key entirely.
      thinking: { type: "disabled" },
      system: systemPrompt(),
      user: buildUserPrompt(input),
      schema: BOARD_INTELLIGENCE_JSON_SCHEMA,
    },
  );
  return { raw: data, usage, model };
}
