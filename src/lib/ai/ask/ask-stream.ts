import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { ASK_TOOLS, executeAskTool } from "@/lib/ai/ask/tools";
import {
  WRITE_TOOLS,
  LIST_MEMBERS_TOOL,
  createWriteToolExecutor,
} from "@/lib/ai/write/write-tools";
import type { ValidatedAction } from "@/lib/ai/write/schema";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import {
  PROPOSAL_FALLBACK_ANSWER,
  type AskStreamEvent,
} from "./stream-protocol";

/** Hard cap on tool-use rounds. Bounds worst-case token spend + latency; when
 *  hit, the loop forces one final no-tools answer from what it has gathered. */
const MAX_ROUNDS = 6;

/** Read tools execute for real and feed content back to the model; everything
 *  else (list_board_members + the propose_* tools) goes through the
 *  propose-only writer, which NEVER mutates. */
const READ_TOOL_NAMES = new Set(ASK_TOOLS.map((t) => t.name));

/** Concatenate the text blocks of a model response, dropping tool_use/other blocks. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Streaming twin of `askPulseLoop`: drives the Ask Pulse Anthropic tool-use loop
 * with a prebuilt `messages` array + `system`, and STREAMS the final answer's
 * text deltas via `emit`. Tool rounds run buffered between streams; the terminal
 * answer streams token-by-token. Usage is summed across every round so the
 * caller meters the full turn. RLS-scoped tool execution throughout.
 *
 * Phase 2: the loop also carries the propose-only WRITE_TOOLS. Unlike a read
 * tool, a propose_* tool RECORDS a ValidatedAction and returns nothing the model
 * needs in order to continue — so the turn ENDS at the confirm card. Anthropic
 * emits text blocks BEFORE the tool_use block in the same message, so the
 * user still gets a streamed lead-in sentence for free, and we never give the
 * model a turn in which it could claim (past tense) to have done the write.
 *
 * `askPulseLoop` in ./ask.ts stays READ-ONLY — only this streaming twin writes.
 */
export async function askPulseStream(args: {
  apiKey: string;
  orgId: string;
  workspaceId: string;
  messages: Anthropic.MessageParam[];
  system: string;
  emit: (e: AskStreamEvent) => void;
  client?: Anthropic; // DI for tests
}): Promise<{
  answer: string;
  boardsConsulted: string[];
  proposedActions: ValidatedAction[];
  usage: AiUsageTokens;
}> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const writer = createWriteToolExecutor({
    orgId: args.orgId,
    workspaceId: args.workspaceId,
  });
  const tools = [...ASK_TOOLS, LIST_MEMBERS_TOOL, ...WRITE_TOOLS];
  const messages = [...args.messages];
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };
  const boards = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let streamedText = "";
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: args.system,
      tools,
      messages,
    });
    stream.on("text", (t) => {
      streamedText += t;
      args.emit({ type: "token", text: t });
    });
    const final = await stream.finalMessage();
    usage.inputTokens += final.usage.input_tokens;
    usage.outputTokens += final.usage.output_tokens;

    if (final.stop_reason !== "tool_use") {
      const answer = streamedText || textOf(final.content);
      return {
        answer,
        boardsConsulted: [...boards],
        proposedActions: [],
        usage,
      };
    }

    messages.push({ role: "assistant", content: final.content });
    const collectedBefore = writer.collected().length;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let consulted = 0;
    for (const block of final.content) {
      if (block.type !== "tool_use") continue;
      if (READ_TOOL_NAMES.has(block.name)) {
        const r = await executeAskTool(block.name, block.input, {
          workspaceId: args.workspaceId,
        });
        if (r.boardId) {
          boards.add(r.boardId);
          consulted++;
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: r.content,
        });
        continue;
      }
      const r = await writer.execute(block.name, block.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: r.content,
      });
    }

    // The branch: a proposal was RECORDED, so the turn is over — the only thing
    // that can happen next is a human decision. Keyed off the collected count
    // growing, not off the tool name: a propose_* call that FAILED (bad id,
    // unknown group) collects nothing, and its {"error": …} result falls through
    // to the normal feed-back below so the model can self-correct.
    const proposed = writer.collected() as ValidatedAction[];
    if (proposed.length > collectedBefore) {
      args.emit({ type: "proposal", actions: proposed });
      return {
        answer: streamedText || PROPOSAL_FALLBACK_ANSWER,
        boardsConsulted: [...boards],
        proposedActions: proposed,
        usage,
      };
    }

    // Guard: model signalled tool_use but emitted no tool_use blocks — bail to
    // the final-answer fallback rather than push an empty user turn.
    if (toolResults.length === 0) break;
    args.emit({
      type: "status",
      text: consulted
        ? `Consulting ${boards.size} board${boards.size === 1 ? "" : "s"}…`
        : "Thinking…",
    });
    messages.push({ role: "user", content: toolResults });
  }

  // Cap reached (or an empty tool turn): one final buffered answer.
  const capped = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: args.system,
    messages: [
      ...messages,
      { role: "user", content: "Answer now with what you have." },
    ],
  });
  usage.inputTokens += capped.usage.input_tokens;
  usage.outputTokens += capped.usage.output_tokens;
  const answer = textOf(capped.content);
  args.emit({ type: "token", text: answer });
  return { answer, boardsConsulted: [...boards], proposedActions: [], usage };
}
