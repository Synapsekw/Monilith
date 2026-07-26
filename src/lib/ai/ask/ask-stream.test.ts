import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AskStreamEvent } from "./stream-protocol";

// The real tool modules hit Supabase. Mock both so the loop's CONTROL FLOW is
// what's under test, not the tools themselves (they have their own suites).
const mockExecuteAskTool = vi.fn();
const mockWriterExecute = vi.fn();
let collected: unknown[] = [];

vi.mock("@/lib/ai/ask/tools", () => ({
  ASK_TOOLS: [{ name: "list_boards" }, { name: "get_board_overview" }],
  executeAskTool: (...a: unknown[]) => mockExecuteAskTool(...a),
}));
vi.mock("@/lib/ai/write/write-tools", () => ({
  WRITE_TOOLS: [{ name: "propose_create_item" }],
  LIST_MEMBERS_TOOL: { name: "list_board_members" },
  createWriteToolExecutor: () => ({
    execute: (...a: unknown[]) => mockWriterExecute(...a),
    collected: () => collected,
  }),
}));

import { askPulseStream } from "./ask-stream";

type Round = {
  text?: string;
  stop_reason: "tool_use" | "end_turn";
  content: unknown[];
};

/** Scripted Anthropic double: one entry per `.stream()` call. */
function fakeClient(rounds: Round[]) {
  let i = 0;
  return {
    messages: {
      stream: vi.fn(() => {
        const round = rounds[i++];
        const handlers: Record<string, (arg: string) => void> = {};
        const p = {
          on: (evt: string, cb: (arg: string) => void) => {
            handlers[evt] = cb;
            return p;
          },
          finalMessage: async () => {
            if (round.text) handlers["text"]?.(round.text);
            return {
              stop_reason: round.stop_reason,
              content: round.content,
              usage: { input_tokens: 5, output_tokens: 2 },
            };
          },
        };
        return p;
      }),
      create: vi.fn(async () => ({
        content: [{ type: "text", text: "capped" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
    },
  };
}

const ACTION = {
  kind: "create_item",
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: [],
};

const run = (
  client: unknown,
  emit: (e: AskStreamEvent) => void,
  messages = [{ role: "user" as const, content: "hi" }],
) =>
  askPulseStream({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- scripted structural double
    client: client as any,
    apiKey: "k",
    orgId: "org1",
    workspaceId: "ws1",
    messages,
    system: "SYS",
    emit,
  });

beforeEach(() => {
  vi.clearAllMocks();
  collected = [];
});

describe("askPulseStream", () => {
  it("streams text deltas and returns the final answer + usage (read-only path)", async () => {
    const tokens: string[] = [];
    const client = fakeClient([
      {
        text: "Hello",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Hello" }],
      },
    ]);
    const res = await run(client, (e) => {
      if (e.type === "token") tokens.push(e.text);
    });
    expect(tokens.join("")).toBe("Hello");
    expect(res.answer).toBe("Hello");
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(res.boardsConsulted).toEqual([]);
    expect(res.proposedActions).toEqual([]);
  });

  it("ENDS the turn when a propose tool records an action", async () => {
    // The writer collects on execute — that growth is the branch condition.
    mockWriterExecute.mockImplementation(async () => {
      collected = [ACTION];
      return { content: JSON.stringify({ preview: ACTION.summary }) };
    });
    const client = fakeClient([
      {
        text: "I'll create that — ",
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "I'll create that — " },
          {
            type: "tool_use",
            id: "t1",
            name: "propose_create_item",
            input: {},
          },
        ],
      },
    ]);
    const events: AskStreamEvent[] = [];
    const res = await run(client, (e) => events.push(e));

    expect(client.messages.stream).toHaveBeenCalledTimes(1);
    expect(client.messages.create).not.toHaveBeenCalled();
    expect(res.proposedActions).toEqual([ACTION]);
    expect(res.answer).toBe("I'll create that — ");
    expect(events).toContainEqual({ type: "proposal", actions: [ACTION] });
  });

  it("falls back to shared copy when a proposal turn streamed no text", async () => {
    mockWriterExecute.mockImplementation(async () => {
      collected = [ACTION];
      return { content: "{}" };
    });
    const client = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_create_item",
            input: {},
          },
        ],
      },
    ]);
    const res = await run(client, () => {});
    expect(res.answer).toBe("Here's what I'll do — confirm below.");
  });

  it("does NOT end the turn when the propose tool errored — it feeds back and continues", async () => {
    // collected never grows: createWriteToolExecutor records nothing on error.
    mockWriterExecute.mockResolvedValue({
      content: JSON.stringify({ error: "board not found" }),
    });
    const client = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "propose_create_item",
            input: {},
          },
        ],
      },
      {
        text: "Which board did you mean?",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Which board did you mean?" }],
      },
    ]);
    const events: AskStreamEvent[] = [];
    const res = await run(client, (e) => events.push(e));

    expect(client.messages.stream).toHaveBeenCalledTimes(2);
    expect(res.proposedActions).toEqual([]);
    expect(res.answer).toBe("Which board did you mean?");
    expect(events.some((e) => e.type === "proposal")).toBe(false);
  });

  it("still runs read tools and tracks boardsConsulted", async () => {
    mockExecuteAskTool.mockResolvedValue({ content: "[]", boardId: "b1" });
    const client = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t1", name: "get_board_overview", input: {} },
        ],
      },
      {
        text: "Two overdue.",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Two overdue." }],
      },
    ]);
    const res = await run(client, () => {});
    expect(mockExecuteAskTool).toHaveBeenCalled();
    expect(res.boardsConsulted).toEqual(["b1"]);
  });
});
