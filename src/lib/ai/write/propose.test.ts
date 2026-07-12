import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("@/lib/ai/ask/tools", () => ({
  ASK_TOOLS: [
    { name: "list_boards", input_schema: { type: "object", properties: {} } },
  ],
  executeAskTool: vi.fn(async () => ({
    content: JSON.stringify([{ id: "b1", name: "Roadmap" }]),
  })),
}));
vi.mock("./write-tools", () => ({
  WRITE_TOOLS: [
    {
      name: "propose_create_item",
      input_schema: { type: "object", properties: {} },
    },
  ],
  LIST_MEMBERS_TOOL: {
    name: "list_board_members",
    input_schema: { type: "object", properties: {} },
  },
  createWriteToolExecutor: vi.fn(() => ({
    execute: vi.fn(async () => ({ content: "{}" })),
    collected: () => [
      {
        kind: "create_item",
        boardId: "b1",
        groupId: "g1",
        name: "Ship v2",
        summary: 'Create task "Ship v2" in Backlog',
        warnings: [],
      },
    ],
  })),
}));

import { proposeLoop } from "./propose";

// Fake Anthropic: round 1 → tool_use (list_boards then propose_create_item); round 2 → end_turn.
function fakeClient() {
  let round = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        round++;
        if (round === 1) {
          return {
            stop_reason: "tool_use",
            content: [
              { type: "tool_use", id: "t1", name: "list_boards", input: {} },
              {
                type: "tool_use",
                id: "t2",
                name: "propose_create_item",
                input: { board_id: "b1", group_id: "g1", name: "Ship v2" },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Ready to create." }],
          usage: { input_tokens: 3, output_tokens: 2 },
        };
      }),
    },
  };
}

describe("proposeLoop", () => {
  it("returns collected proposals and sums usage", async () => {
    const client = fakeClient();
    const res = await proposeLoop({
      apiKey: "k",
      orgId: "org1",
      workspaceId: "ws1",
      instruction: "create task Ship v2 in Backlog",
      client: client as unknown as Anthropic,
    });
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].name).toBe("Ship v2");
    expect(res.usage).toEqual({ inputTokens: 13, outputTokens: 7 });
    // Read tool executed for real.
    const { executeAskTool } = await import("@/lib/ai/ask/tools");
    expect(executeAskTool).toHaveBeenCalledWith(
      "list_boards",
      {},
      { workspaceId: "ws1" },
    );
  });

  it("returns a clarification when the model proposes nothing", async () => {
    const client = {
      messages: {
        create: vi.fn(async () => ({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Which board?" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    };
    const { createWriteToolExecutor } = await import("./write-tools");
    vi.mocked(createWriteToolExecutor).mockReturnValueOnce({
      execute: vi.fn(),
      collected: () => [],
    });
    const res = await proposeLoop({
      apiKey: "k",
      orgId: "o",
      workspaceId: "w",
      instruction: "do a thing",
      client: client as unknown as Anthropic,
    });
    expect(res.actions).toHaveLength(0);
    expect(res.clarification).toBe("Which board?");
  });
});
