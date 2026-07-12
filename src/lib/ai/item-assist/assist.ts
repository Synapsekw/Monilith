import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { MODEL } from "@/lib/ai/providers/anthropic";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import {
  buildItemAssistJsonSchema,
  type ItemAssistProposal,
  type ItemAssistWant,
} from "@/lib/ai/item-assist/schema";

/** Task-scoped system prompt: only describes the fields present in `want`,
 *  and instructs the model to draw only on the privacy-bounded context given
 *  in the user turn (item name/text/status options/thread excerpt). */
function buildSystemPrompt(want: ItemAssistWant): string {
  const lines = [
    "You assist with a single work-board item.",
    "Base every proposal ONLY on the item name, text context, status options, and thread excerpt given below — never invent facts not present there.",
    "Only propose the field(s) requested below; do not add anything else.",
  ];
  if (want.description) {
    lines.push(
      "- description: a concise, useful draft for the item's description text field.",
    );
  }
  if (want.subtasks) {
    lines.push(
      "- subtasks: a short list of concrete, actionable child item names.",
    );
  }
  if (want.status) {
    lines.push(
      "- status: pick the single best-fit option id (from the given status options) for this item's current state.",
    );
  }
  return lines.join("\n");
}

function buildUserPrompt(args: {
  item: { name: string; textContext?: string };
  statusOptions?: { id: string; label: string }[];
  thread?: string;
  want: ItemAssistWant;
}): string {
  const lines = [`Item name: ${args.item.name}`];
  if (args.item.textContext) {
    lines.push(`Item text context: ${args.item.textContext}`);
  }
  if (args.want.status) {
    const opts = args.statusOptions ?? [];
    lines.push(
      `Status options: ${opts.map((o) => `${o.id}=${o.label}`).join(", ")}`,
    );
  }
  if (args.thread) {
    lines.push(`Recent thread excerpt: ${args.thread}`);
  }
  return lines.join("\n");
}

/**
 * Generate a structured item-assist proposal (draft description / suggest
 * subtasks / propose a status option) for a single board item. The JSON
 * schema handed to the model only exposes the sub-parts present in `want`
 * (see buildItemAssistJsonSchema), so unused fields stay absent rather than
 * relying on the model to omit them voluntarily.
 *
 * `client` is injectable for tests (mirrors askPulseLoop in ask.ts) so unit
 * tests never make a network call.
 */
export async function generateItemAssist(args: {
  apiKey: string;
  item: { name: string; textContext?: string };
  statusOptions?: { id: string; label: string }[];
  thread?: string;
  want: ItemAssistWant;
  client?: Anthropic;
}): Promise<{ proposal: ItemAssistProposal; usage: AiUsageTokens }> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const statusOptionIds = args.want.status
    ? (args.statusOptions ?? []).map((o) => o.id)
    : [];
  const schema = buildItemAssistJsonSchema(args.want, statusOptionIds);

  const message = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: jsonSchemaOutputFormat(schema as never),
    },
    system: [
      {
        type: "text",
        text: buildSystemPrompt(args.want),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildUserPrompt(args) }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const parsed =
    (message as { parsed_output?: unknown }).parsed_output ??
    JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}");
  const raw = parsed as {
    description?: string;
    subtasks?: string[];
    status?: { optionId?: string };
  };

  const proposal: ItemAssistProposal = {};
  if (args.want.description && typeof raw.description === "string") {
    proposal.description = raw.description;
  }
  if (args.want.subtasks && Array.isArray(raw.subtasks)) {
    proposal.subtasks = raw.subtasks;
  }
  if (args.want.status && raw.status?.optionId) {
    proposal.status = {
      columnId: args.want.status.columnId,
      optionId: raw.status.optionId,
    };
  }

  return {
    proposal,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}
