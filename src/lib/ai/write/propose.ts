import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { modelFor } from "@/lib/ai/model-map";
import { ASK_TOOLS, executeAskTool } from "@/lib/ai/ask/tools";
import {
  WRITE_TOOLS,
  LIST_MEMBERS_TOOL,
  createWriteToolExecutor,
} from "./write-tools";
import type { ValidatedAction } from "./schema";
import type { AiUsageTokens } from "@/lib/ai/pricing";

/** Hard cap on tool-use rounds — bounds worst-case token spend + latency. Mirrors askPulseStream. */
const MAX_ROUNDS = 6;
const READ_TOOL_NAMES = new Set(ASK_TOOLS.map((t) => t.name));

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function systemPrompt(now: string, timezone: string): string {
  return [
    "You turn a user's natural-language command into PROPOSED board writes.",
    `Today is ${now} (timezone ${timezone}). Resolve relative dates like "Friday" to an ISO date (YYYY-MM-DD).`,
    "First use the read tools (list_boards, get_board_overview, list_board_members) to resolve the exact board, group, status option, and owner userIds. get_board_overview decodes status option labels and returns the board's `groups` with their ids.",
    "To change or move an EXISTING item you need its item_id: call query_items on that board and take the `id` field of the matching row (semantic_search_items also returns item ids when the board is unknown).",
    "Then call a propose_* tool with the resolved ids. NEVER assume ids you haven't read.",
    "The propose_* tools do NOT write — the user confirms before anything happens.",
    "If the target board/group is ambiguous or you can't find it, DO NOT propose — reply with a short question instead.",
    "Ask exactly ONE focused question at a time; never batch multiple questions. The user will reply and you can ask the next one.",
  ].join("\n");
}

/**
 * Drive the conversational-action tool-use loop. Read tools (F5's `ASK_TOOLS`
 * plus `list_board_members`) execute for real (RLS-scoped, read-only); the
 * proposal write tools only RECORD a `ValidatedAction` and never mutate. When
 * the model stops with no proposals, its final text becomes a `clarification`.
 * The Anthropic client is dependency-injected for tests.
 */
export async function proposeLoop(args: {
  apiKey: string;
  orgId: string;
  workspaceId: string;
  instruction: string;
  /** Prior transcript to continue (from an earlier clarification turn). */
  messages?: Anthropic.MessageParam[];
  now?: string;
  timezone?: string;
  client?: Anthropic;
}): Promise<{
  actions: ValidatedAction[];
  clarification?: string;
  usage: AiUsageTokens;
  messages: Anthropic.MessageParam[];
  /** The model actually used — reported to runAi so the ledger is truthful. */
  model: string;
}> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const choice = modelFor("conversational_action");
  const writer = createWriteToolExecutor({
    orgId: args.orgId,
    workspaceId: args.workspaceId,
  });
  const tools = [...ASK_TOOLS, LIST_MEMBERS_TOOL, ...WRITE_TOOLS];
  // Continue a prior transcript when given, appending this turn's instruction.
  const messages: Anthropic.MessageParam[] = [
    ...(args.messages ?? []),
    { role: "user", content: args.instruction },
  ];
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };
  const system = systemPrompt(
    args.now ?? new Date().toISOString().slice(0, 10),
    args.timezone ?? "UTC",
  );

  let finalText = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model: choice.model,
      max_tokens: 4096,
      // MUST be explicit: omitting `thinking` on a Sonnet-tier model runs
      // adaptive thinking at effort "high", and max_tokens caps thinking PLUS
      // the tool_use block. Disabled — NOT choice.thinking — because this
      // 4096 budget was sized for a no-thinking model, the system prompt above
      // already prescribes the tool sequence step by step (so the "reaches for
      // tools less with thinking off" effect has little room to bite), and a
      // turn that produces no tool_use degrades gracefully into a
      // clarification rather than silently losing work.
      thinking: { type: "disabled" },
      system,
      tools,
      messages,
    });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;

    if (res.stop_reason !== "tool_use") {
      finalText = textOf(res.content);
      // Keep the final assistant turn in the transcript so a clarification can
      // be threaded back into the next reply.
      messages.push({ role: "assistant", content: res.content });
      break;
    }

    messages.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      // F5 read tools (list_boards/get_board_overview/query_items) execute for
      // real; list_board_members + the propose_* tools go through the writer.
      const result = READ_TOOL_NAMES.has(block.name)
        ? await executeAskTool(block.name, block.input, {
            workspaceId: args.workspaceId,
          })
        : await writer.execute(block.name, block.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
      });
    }
    if (toolResults.length === 0) break;
    messages.push({ role: "user", content: toolResults });
  }

  const actions = writer.collected();
  return {
    actions,
    clarification: actions.length === 0 ? finalText || undefined : undefined,
    usage,
    messages,
    model: choice.model,
  };
}
