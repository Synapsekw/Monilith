import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { requestShapeFor } from "@/lib/ai/model-map";
import {
  COLUMN_FILL_JSON_SCHEMA,
  type ClassifyRow,
  type Classification,
  type TargetOption,
} from "@/lib/ai/column-fill/schema";
import type { AiUsageTokens } from "@/lib/ai/pricing";

const SYSTEM = [
  "You classify each row's free-text value against a fixed list of target options.",
  "For every row, map its text to the single best-matching target option's `id`.",
  "If no target option is a confident match, set `optionId` to null — never guess.",
  "Return exactly one output row per input row, in any order, keyed by `itemId`.",
].join("\n");

type ParsedOutput = { rows: { itemId: string; optionId: string | null }[] };

/**
 * The cheap tier's context window is 200K, not 1M. classifyColumn serialises
 * every row into a single user message, so above this row count the CALLER asks
 * runAi for the `standard` tier instead — the row count is known before the
 * call, and the model has to be resolved before the key is spent. Exported so
 * the decision and the limit cannot drift apart.
 */
export const HAIKU_ROW_LIMIT = 2000;

/**
 * Classifies free-text rows against a fixed set of target options using
 * Anthropic structured output (mirrors the `messages.parse` call in
 * src/lib/ai/providers/anthropic.ts). `client` is injectable for tests so no
 * network call is ever made in the suite.
 */
export async function classifyColumn(args: {
  apiKey: string;
  /** The WIRE model id to run, resolved by runAi (`requestModel`). */
  model: string;
  rows: ClassifyRow[];
  targetOptions: TargetOption[];
  client?: Anthropic; // DI for tests
}): Promise<{
  classifications: Classification[];
  usage: AiUsageTokens;
  model: string;
}> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const shape = requestShapeFor(args.model);
  const user = JSON.stringify({
    rows: args.rows,
    targetOptions: args.targetOptions,
  });

  const message = await client.messages.parse({
    model: args.model,
    max_tokens: 16000,
    thinking: shape.thinking,
    output_config: {
      // Haiku 4.5 rejects `effort` — omit the key entirely rather than
      // sending undefined, which the SDK would still serialize.
      ...(shape.effort ? { effort: shape.effort } : {}),
      format: jsonSchemaOutputFormat(COLUMN_FILL_JSON_SCHEMA as never),
    },
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: user }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const parsed = ((message as { parsed_output?: unknown }).parsed_output ??
    JSON.parse(
      textBlock && "text" in textBlock ? textBlock.text : "{}",
    )) as ParsedOutput;

  return {
    classifications: (parsed.rows ?? []).map((r) => ({
      itemId: r.itemId,
      optionId: r.optionId,
    })),
    model: args.model,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
