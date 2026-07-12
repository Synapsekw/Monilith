import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { ASK_TOOLS, executeAskTool } from "@/lib/ai/ask/tools";
import {
  WRITE_TOOLS,
  LIST_MEMBERS_TOOL,
  createWriteToolExecutor,
} from "./write-tools";
import type { ValidatedAction } from "./schema";
import type { AiUsageTokens } from "@/lib/ai/pricing";

/** Hard cap on tool-use rounds — bounds worst-case token spend + latency. Mirrors askPulseLoop. */
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
    "First use the read tools (list_boards, get_board_overview, list_board_members) to resolve the exact board, group, status option, and owner userIds. get_board_overview decodes status option labels.",
    "Then call a propose_* tool with the resolved ids. NEVER assume ids you haven't read.",
    "The propose_* tools do NOT write — the user confirms before anything happens.",
    "If the target board/group is ambiguous or you can't find it, DO NOT propose — reply with a short question instead.",
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
  now?: string;
  timezone?: string;
  client?: Anthropic;
}): Promise<{
  actions: ValidatedAction[];
  clarification?: string;
  usage: AiUsageTokens;
}> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const writer = createWriteToolExecutor({
    orgId: args.orgId,
    workspaceId: args.workspaceId,
  });
  const tools = [...ASK_TOOLS, LIST_MEMBERS_TOOL, ...WRITE_TOOLS];
  const messages: Anthropic.MessageParam[] = [
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
      model: MODEL,
      max_tokens: 4096,
      system,
      tools,
      messages,
    });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;

    if (res.stop_reason !== "tool_use") {
      finalText = textOf(res.content);
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
  };
}
