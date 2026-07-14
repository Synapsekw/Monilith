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
    const first = res.actions[0];
    expect(first.kind).toBe("create_item");
    if (first.kind !== "create_item") throw new Error("expected create_item");
    expect(first.name).toBe("Ship v2");
    expect(res.usage).toEqual({ inputTokens: 13, outputTokens: 7 });
    // Read tool executed for real.
    const { executeAskTool } = await import("@/lib/ai/ask/tools");
    expect(executeAskTool).toHaveBeenCalledWith(
      "list_boards",
      {},
      { workspaceId: "ws1" },
    );
  });

  it("threads a prior transcript and appends the new instruction as a user turn", async () => {
    const client = fakeClient();
    const seed: Anthropic.MessageParam[] = [
      { role: "user", content: "create task Ship v2" },
      { role: "assistant", content: [{ type: "text", text: "Which board?" }] },
    ];
    const res = await proposeLoop({
      apiKey: "k",
      orgId: "o",
      workspaceId: "w",
      instruction: "the Roadmap board",
      messages: seed,
      client: client as unknown as Anthropic,
    });
    // The first model call saw the seed with the reply appended as the last turn.
    const [firstCall] = client.messages.create.mock.calls as unknown as [
      [{ messages: Anthropic.MessageParam[] }],
    ];
    const sent = firstCall[0].messages;
    expect(sent[0]).toEqual(seed[0]);
    expect(sent[1]).toEqual(seed[1]);
    expect(sent[2]).toEqual({ role: "user", content: "the Roadmap board" });
    // A proposal was reached and the returned transcript grew past the seed.
    expect(res.actions).toHaveLength(1);
    expect(res.messages.length).toBeGreaterThan(seed.length + 1);
    expect(res.messages[0]).toEqual(seed[0]);
  });

  it("returns the running transcript so a clarification can be continued", async () => {
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
    expect(res.clarification).toBe("Which board?");
    expect(res.messages[0]).toEqual({ role: "user", content: "do a thing" });
    expect(res.messages.at(-1)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Which board?" }],
    });
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
