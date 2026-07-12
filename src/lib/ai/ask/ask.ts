import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { ASK_TOOLS, executeAskTool } from "@/lib/ai/ask/tools";
import type { AiUsageTokens } from "@/lib/ai/pricing";

/** Hard cap on tool-use rounds. Bounds worst-case token spend + latency; when
 *  hit, the loop forces one final no-tools answer from what it has gathered. */
const MAX_ROUNDS = 6;

const SYSTEM = [
  "You answer questions about the user's work boards.",
  "Answer ONLY from tool results — never invent boards, items, or values.",
  "Start broad (list_boards, get_board_overview) and use query_items only for the specific rows a question needs.",
  "Cell values reference option/user ids — call get_board_overview first to decode status/dropdown option labels before answering.",
  "In your answer, name the boards you consulted. If the tools can't answer the question, say so plainly.",
].join("\n");

/** Concatenate the text blocks of a model response, dropping tool_use/other blocks. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Drive the Ask Pulse Anthropic tool-use loop: the model calls the read-only
 * board tools (dispatched through `executeAskTool`, RLS-scoped) until it stops
 * asking for tools, then returns its final answer. Usage is summed across every
 * round so the caller meters the full conversation.
 */
export async function askPulseLoop(args: {
  apiKey: string;
  workspaceId: string;
  question: string;
  client?: Anthropic; // DI for tests
}): Promise<{
  answer: string;
  boardsConsulted: string[];
  usage: AiUsageTokens;
}> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: args.question },
  ];
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };
  const boardsConsulted = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: ASK_TOOLS,
      messages,
    });
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    if (response.stop_reason !== "tool_use") {
      return {
        answer: textOf(response.content),
        boardsConsulted: [...boardsConsulted],
        usage,
      };
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const result = await executeAskTool(block.name, block.input, {
        workspaceId: args.workspaceId,
      });
      if (result.boardId) boardsConsulted.add(result.boardId);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
      });
    }
    // Guard: the model signalled tool_use but emitted no tool_use blocks.
    // Pushing an empty user turn wastes a round (or errors on the next call),
    // so bail to the final-answer fallback instead.
    if (toolResults.length === 0) break;
    messages.push({ role: "user", content: toolResults });
  }

  // Round cap reached — force a final answer from what's gathered (no tools).
  messages.push({ role: "user", content: "Answer now with what you have." });
  const last = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages,
  });
  usage.inputTokens += last.usage.input_tokens;
  usage.outputTokens += last.usage.output_tokens;
  return {
    answer: textOf(last.content),
    boardsConsulted: [...boardsConsulted],
    usage,
  };
}
