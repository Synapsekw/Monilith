import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { autopilotRun, AUTOPILOT_ACTIONS } from "./autopilot";
import type { AutopilotContext } from "./autopilot";

// Real uuids — automationActionSchema gates columnId/userId/groupId with .uuid().
const COL_PROGRESS = "00000000-0000-4000-8000-000000000002";
const COL_OWNER = "00000000-0000-4000-8000-000000000003";
const GRP_BACKLOG = "00000000-0000-4000-8000-000000000004";
const GRP_ACTIVE = "00000000-0000-4000-8000-000000000005";
const USER_ADA = "00000000-0000-4000-8000-0000000000a1";
const ITEM_1 = "00000000-0000-4000-8000-0000000000c1";
const ITEM_2 = "00000000-0000-4000-8000-0000000000c2";

const CTX: AutopilotContext = {
  boardId: "00000000-0000-4000-8000-0000000000b0",
  columns: [
    { id: COL_PROGRESS, name: "Progress", kind: "percent", options: [] },
    { id: COL_OWNER, name: "Owner", kind: "people", options: [] },
  ],
  groups: [
    { id: GRP_BACKLOG, name: "Backlog" },
    { id: GRP_ACTIVE, name: "Active" },
  ],
  members: [{ id: USER_ADA, name: "Ada" }],
  items: [
    { id: ITEM_1, name: "Untriaged idea", groupId: null },
    { id: ITEM_2, name: "Ship the thing", groupId: GRP_ACTIVE },
  ],
};

/** A fake Anthropic client that replays a scripted queue of responses. */
function fakeClient(responses: Partial<Anthropic.Message>[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        calls.push(params);
        const r = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return {
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [],
          ...r,
        } as Anthropic.Message;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Anthropic;
  return { client, calls };
}

function toolUse(name: string, input: unknown): Anthropic.ContentBlock {
  return {
    type: "tool_use",
    id: `tu-${name}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    input,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("autopilotRun", () => {
  it("collects a bounded set of referentially-valid housekeeping actions", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          toolUse("move_to_group", { item_id: ITEM_1, group_id: GRP_BACKLOG }),
          toolUse("set_percent", {
            item_id: ITEM_2,
            column_id: COL_PROGRESS,
            percent: 100,
          }),
        ],
      },
      { stop_reason: "end_turn", content: [] },
    ]);
    const res = await autopilotRun({
      apiKey: "k",
      agentContext: CTX,
      tasks: ["triage", "goal_rollup"],
      client,
    });
    expect(res.actions).toEqual([
      {
        itemId: ITEM_1,
        action: { type: "move_to_group", groupId: GRP_BACKLOG },
      },
      {
        itemId: ITEM_2,
        action: { type: "set_percent", columnId: COL_PROGRESS, percent: 100 },
      },
    ]);
    expect(res.warnings).toEqual([]);
    expect(res.usage.inputTokens).toBeGreaterThan(0);
  });

  it("offers only the tools for the enabled tasks (confinement of the vocabulary)", async () => {
    const { client, calls } = fakeClient([
      { stop_reason: "end_turn", content: [] },
    ]);
    await autopilotRun({
      apiKey: "k",
      agentContext: CTX,
      tasks: ["triage"],
      client,
    });
    // triage => only move_to_group is offered; never set_option/call_webhook.
    expect(calls[0]!.tools?.map((t) => t.name)).toEqual(["move_to_group"]);
  });

  it("drops a move to a foreign-board group with a warning (confinement)", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          toolUse("move_to_group", {
            item_id: ITEM_1,
            group_id: "grp-FOREIGN",
          }),
        ],
      },
      { stop_reason: "end_turn", content: [] },
    ]);
    const res = await autopilotRun({
      apiKey: "k",
      agentContext: CTX,
      tasks: ["triage"],
      client,
    });
    expect(res.actions).toEqual([]);
    expect(res.warnings.join(" ")).toMatch(/grp-FOREIGN|not on this board/i);
  });

  it("drops an action targeting a foreign item id with a warning", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          toolUse("set_percent", {
            item_id: "item-FOREIGN",
            column_id: COL_PROGRESS,
            percent: 50,
          }),
        ],
      },
      { stop_reason: "end_turn", content: [] },
    ]);
    const res = await autopilotRun({
      apiKey: "k",
      agentContext: CTX,
      tasks: ["goal_rollup"],
      client,
    });
    expect(res.actions).toEqual([]);
    expect(res.warnings.join(" ")).toMatch(/item-FOREIGN|not on this board/i);
  });

  it("drops a set_option choice (never in the autopilot vocabulary)", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          toolUse("set_option", {
            item_id: ITEM_1,
            column_id: COL_PROGRESS,
            option_id: "opt-x",
          }),
        ],
      },
      { stop_reason: "end_turn", content: [] },
    ]);
    const res = await autopilotRun({
      apiKey: "k",
      agentContext: CTX,
      // enable ALL tasks so the only reason set_option is rejected is the vocabulary.
      tasks: ["triage", "chase_overdue", "goal_rollup"],
      client,
    });
    expect(res.actions).toEqual([]);
    expect(res.warnings.join(" ")).toMatch(
      /set_option|not in the allowed set/i,
    );
    // set_option is not one of the three sanctioned autopilot actions.
    expect(AUTOPILOT_ACTIONS).not.toContain("set_option");
  });

  it("returns no actions when the model does nothing", async () => {
    const { client } = fakeClient([{ stop_reason: "end_turn", content: [] }]);
    const res = await autopilotRun({
      apiKey: "k",
      agentContext: CTX,
      tasks: ["triage", "chase_overdue", "goal_rollup"],
      client,
    });
    expect(res.actions).toEqual([]);
  });
});
