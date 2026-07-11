import { describe, expect, it, vi, beforeEach } from "vitest";

// Record every executeAskTool invocation; each call resolves to a scripted
// tool result (content + optional boardId) so the loop's board-tracking and
// message-threading are observable.
const executeAskTool = vi.fn();
vi.mock("@/lib/ai/ask/tools", () => ({
  ASK_TOOLS: [{ name: "list_boards" }],
  executeAskTool: (...args: unknown[]) => executeAskTool(...args),
}));

type CreateParams = {
  model: string;
  max_tokens: number;
  system: string;
  tools?: unknown;
  messages: { role: string; content: unknown }[];
};

/** A fake Anthropic client whose `messages.create` returns the next scripted
 *  response and records every request params object for later inspection. */
function fakeClient(responses: unknown[]) {
  const calls: CreateParams[] = [];
  let i = 0;
  const create = vi.fn(async (params: CreateParams) => {
    calls.push(params);
    const resp = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return resp;
  });
  return { calls, create, client: { messages: { create } } };
}

const WORKSPACE_ID = "ws-1";

beforeEach(() => {
  executeAskTool.mockReset();
});

describe("askPulseLoop", () => {
  it("runs a tool round then returns the final answer with summed usage", async () => {
    executeAskTool.mockResolvedValueOnce({
      content: JSON.stringify([{ id: "board-1", name: "Sprint" }]),
      boardId: "board-1",
    });

    const { client, calls } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu_1", name: "list_boards", input: {} },
        ],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Answer." }],
        usage: { input_tokens: 200, output_tokens: 50 },
      },
    ]);

    const { askPulseLoop } = await import("@/lib/ai/ask/ask");
    const res = await askPulseLoop({
      apiKey: "k",
      workspaceId: WORKSPACE_ID,
      question: "What boards do I have?",
      client: client as never,
    });

    // The tool was dispatched with (name, input, { workspaceId }).
    expect(executeAskTool).toHaveBeenCalledWith(
      "list_boards",
      {},
      {
        workspaceId: WORKSPACE_ID,
      },
    );

    // The second request carries the assistant tool_use turn plus a user
    // turn whose last message is the tool_result keyed to the tool_use id.
    const second = calls[1];
    const lastMessage = second.messages[second.messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        content: JSON.stringify([{ id: "board-1", name: "Sprint" }]),
      },
    ]);

    expect(res.answer).toBe("Answer.");
    expect(res.usage).toEqual({ inputTokens: 300, outputTokens: 70 });
    expect(res.boardsConsulted).toEqual(["board-1"]);
  });

  it("caps tool rounds at MAX_ROUNDS then forces a final no-tools answer", async () => {
    executeAskTool.mockResolvedValue({ content: "[]" });

    // Always asks for another tool call — the loop must stop itself.
    const alwaysToolUse = {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "tu_x", name: "list_boards", input: {} },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { client, calls } = fakeClient([alwaysToolUse]);

    const { askPulseLoop } = await import("@/lib/ai/ask/ask");
    await askPulseLoop({
      apiKey: "k",
      workspaceId: WORKSPACE_ID,
      question: "loop forever?",
      client: client as never,
    });

    // 6 tool rounds + 1 final forced call = 7 create calls.
    expect(calls).toHaveLength(7);

    // The final call omits `tools` and ends with the forcing nudge.
    const final = calls[6];
    expect(final.tools).toBeUndefined();
    const lastMessage = final.messages[final.messages.length - 1];
    expect(lastMessage).toEqual({
      role: "user",
      content: "Answer now with what you have.",
    });
  });
});
