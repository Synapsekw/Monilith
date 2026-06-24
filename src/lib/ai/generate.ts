import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { getAnthropicClient, MODEL } from "@/lib/ai/anthropic";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

/**
 * System prompt teaching the model the widget vocabulary and grid. Frozen and
 * prompt-cached (see generateProposal) so the cache prefix stays stable across
 * requests.
 */
export function buildSystemPrompt(): string {
  return [
    "You design analytics dashboards for a Monday-style work board.",
    "Output a dashboard proposal: a name and up to 8 widgets on a 12-column grid.",
    "Widget kinds and their config:",
    "- number: { agg: 'count'|'sum'|'avg', valueColumnId?, display?: 'plain'|'gauge', target? }. sum/avg need a numbers column.",
    "- chart: { chartType: 'bar'|'stackedBar'|'groupedBar'|'line'|'area'|'combo'|'pie'|'donut'|'radial', primary: {kind:'status'|'dropdown'|'people'|'date', columnId?, bucket?}, series?: <same>, measure: {agg, valueColumnId?} }.",
    "- battery: { groupColumnId } — must be a status or dropdown column.",
    "- list: { columnIds: string[] (<=8), limit?: number }.",
    "Rules: only reference columnId values that exist in the snapshot. primary/series.kind MUST equal the referenced column's kind. Only status/dropdown/people/date are chartable dimensions; sum/avg measures need a numbers column.",
    "Design well: lead with 1-2 headline number widgets, then charts. Prefer pie/donut for low-cardinality status; bar for categories; line/area for date trends. Don't chart near-empty columns. Give each widget a short human title.",
    "Provide a sensible layout {x,y,w,h} per widget on the 12-column grid (number 3x2, chart 6x4).",
  ].join("\n");
}

function buildUserPrompt(snap: BoardSnapshot, feedback?: string): string {
  return [
    `Board snapshot (schema + aggregate stats, no raw rows):`,
    JSON.stringify(snap),
    feedback ? `\nUser feedback for this revision: ${feedback}` : "",
  ].join("\n");
}

/**
 * Call Opus 4.8 to propose a dashboard for the given board snapshot.
 *
 * Structured output is enforced with `messages.parse()` + `output_config.format`
 * (jsonSchemaOutputFormat) — the most robust mechanism the installed SDK
 * (0.105.0) supports for forcing a single JSON object matching
 * PROPOSAL_JSON_SCHEMA. The parsed result is read from `message.parsed_output`.
 *
 * The client is dependency-injected (`opts.client`) so tests never hit the
 * network; production passes none and we build a server-only client.
 */
export async function generateProposal(
  snap: BoardSnapshot,
  opts: { client?: Anthropic; feedback?: string } = {},
): Promise<DashboardProposal> {
  const client = opts.client ?? getAnthropicClient();

  const message = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Adaptive thinking is the only on-mode for Opus 4.8 (verified against the
    // installed SDK's ThinkingConfigAdaptive type).
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      // PROPOSAL_JSON_SCHEMA is a hand-written `as const` JSON Schema; cast to
      // the helper's expected JSONSchema shape (the const literal is narrower
      // than the helper's generic constraint, but structurally valid).
      format: jsonSchemaOutputFormat(PROPOSAL_JSON_SCHEMA as never),
    },
    system: [
      {
        type: "text",
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildUserPrompt(snap, opts.feedback) }],
  });

  // Prefer the SDK's parsed_output; fall back to JSON.parse of the text block.
  const textBlock = message.content.find((b) => b.type === "text");
  const parsed =
    (message as { parsed_output?: unknown }).parsed_output ??
    JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}");

  return parsed as DashboardProposal;
}
