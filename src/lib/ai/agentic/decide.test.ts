import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { decideAction } from "./decide";
import type { AgenticContext } from "./context";

// Real uuids — automationActionSchema gates columnId/userId/groupId with .uuid().
const COL_STATUS = "00000000-0000-4000-8000-000000000001";
const OPT_TODO = "opt-todo";
const OPT_DONE = "opt-done";
const COL_PROGRESS = "00000000-0000-4000-8000-000000000002";
const COL_OWNER = "00000000-0000-4000-8000-000000000003";
const GRP_BACKLOG = "00000000-0000-4000-8000-000000000004";
const GRP_ACTIVE = "00000000-0000-4000-8000-000000000005";
const USER_ADA = "00000000-0000-4000-8000-0000000000a1";
const USER_GRACE = "00000000-0000-4000-8000-0000000000a2";

const CTX: AgenticContext = {
  columns: [
    {
      id: COL_STATUS,
      name: "Status",
      kind: "status",
      options: [
        { id: OPT_TODO, label: "To do" },
        { id: OPT_DONE, label: "Done" },
      ],
    },
    { id: COL_PROGRESS, name: "Progress", kind: "percent", options: [] },
    { id: COL_OWNER, name: "Owner", kind: "people", options: [] },
  ],
  groups: [
    { id: GRP_BACKLOG, name: "Backlog" },
    { id: GRP_ACTIVE, name: "Active" },
  ],
  members: [
    { id: USER_ADA, name: "Ada" },
    { id: USER_GRACE, name: "Grace" },
  ],
  item: { id: "item-1", name: "Ship the thing" },
};

/** A fake Anthropic client that replays a scripted queue of responses and
 *  records the params of each `messages.create` call. */
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
          stop_reason: "tool_use",
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
    id: `tu-${name}`,
    name,
    input,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("decideAction", () => {
  it("returns the referentially-valid set_option the model chose", async () => {
    const { client, calls } = fakeClient([
      {
        content: [
          toolUse("set_option", { column_id: COL_STATUS, option_id: OPT_DONE }),
        ],
      },
    ]);
    const res = await decideAction({
      apiKey: "k",
      model: "claude-sonnet-5",
      context: CTX,
      instruction: "Mark it done",
      allow: ["set_option"],
      client,
    });
    expect(res.action).toEqual({
      type: "set_option",
      columnId: COL_STATUS,
      optionId: OPT_DONE,
    });
    expect(res.warnings).toEqual([]);
    expect(res.usage.inputTokens).toBe(10);
    // Only the ONE allowed action tool is offered to the model.
    expect(
      calls[0]!.tools?.map((t) => ("name" in t ? t.name : undefined)),
    ).toEqual(["set_option"]);
  });

  it("offers only the allowed action tools", async () => {
    const { client, calls } = fakeClient([
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "no-op" } as never],
      },
    ]);
    await decideAction({
      apiKey: "k",
      model: "claude-sonnet-5",
      context: CTX,
      instruction: "x",
      allow: ["move_to_group", "notify"],
      client,
    });
    expect(
      calls[0]!.tools?.map((t) => ("name" in t ? t.name : undefined)).sort(),
    ).toEqual(["move_to_group", "notify"]);
  });

  it("drops a choice targeting a foreign column id (referential re-validation)", async () => {
    const { client } = fakeClient([
      {
        content: [
          toolUse("set_option", {
            column_id: "col-FOREIGN",
            option_id: "opt-done",
          }),
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "" } as never],
      },
    ]);
    const res = await decideAction({
      apiKey: "k",
      model: "claude-sonnet-5",
      context: CTX,
      instruction: "x",
      allow: ["set_option"],
      client,
    });
    expect(res.action).toBeNull();
    expect(res.warnings.join(" ")).toMatch(/col-FOREIGN|not a valid|unknown/i);
  });

  it("drops a set_option whose option id is not on the column", async () => {
    const { client } = fakeClient([
      {
        content: [
          toolUse("set_option", {
            column_id: COL_STATUS,
            option_id: "opt-FOREIGN",
          }),
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "" } as never],
      },
    ]);
    const res = await decideAction({
      apiKey: "k",
      model: "claude-sonnet-5",
      context: CTX,
      instruction: "x",
      allow: ["set_option"],
      client,
    });
    expect(res.action).toBeNull();
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("validates a notify(member) against the member roster", async () => {
    const { client } = fakeClient([
      {
        content: [
          toolUse("notify", { recipient_kind: "member", user_id: USER_GRACE }),
        ],
      },
    ]);
    const res = await decideAction({
      apiKey: "k",
      model: "claude-sonnet-5",
      context: CTX,
      instruction: "ping grace",
      allow: ["notify"],
      client,
    });
    expect(res.action).toEqual({
      type: "notify",
      recipient: { kind: "member", userId: USER_GRACE },
    });
  });

  it("returns null when the model stops without choosing an action", async () => {
    const { client } = fakeClient([
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I can't decide" } as never],
      },
    ]);
    const res = await decideAction({
      apiKey: "k",
      model: "claude-sonnet-5",
      context: CTX,
      instruction: "x",
      allow: ["set_option"],
      client,
    });
    expect(res.action).toBeNull();
  });

  // Regression guard: the request must state `thinking` explicitly. Omitting it
  // on a Sonnet-tier model means ADAPTIVE thinking at effort "high", and
  // max_tokens caps thinking PLUS the tool_use block — a thinking block would
  // consume this 1024-token budget, leaving no tool_use, and the automation
  // step would silently do nothing. Deliberately NOT choice.thinking.
  it("routes automation_ai_step through the model map and disables thinking", async () => {
    const { client, calls } = fakeClient([
      {
        content: [
          toolUse("set_option", { column_id: COL_STATUS, option_id: OPT_DONE }),
        ],
      },
    ]);
    const res = await decideAction({
      apiKey: "k",
      model: "claude-sonnet-5",
      context: CTX,
      instruction: "Mark it done",
      allow: ["set_option"],
      client,
    });
    expect(calls[0]!.model).toBe("claude-sonnet-5");
    expect(calls[0]!.thinking).toEqual({ type: "disabled" });
    expect(calls[0]!.max_tokens).toBe(1024);
    // Reported back: the model the caller resolved is the one that ran.
    expect(res.model).toBe("claude-sonnet-5");
  });
});
