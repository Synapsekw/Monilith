import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
}));

import {
  listChats,
  listBriefings,
  getMessages,
  getConversationRunId,
  getConversationHeader,
  toThreadMessages,
  currentPersonaFrom,
} from "./conversations";

beforeEach(() => from.mockReset());

describe("listChats / listBriefings", () => {
  it("lists only threads with no run, bounded and newest-first", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "c1" }], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const is = vi.fn().mockReturnValue({ order });
    const eq = vi.fn().mockReturnValue({ is });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    await listChats("user-1");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(is).toHaveBeenCalledWith("run_id", null);
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it("lists only briefings", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const not = vi.fn().mockReturnValue({ order });
    const eq = vi.fn().mockReturnValue({ not });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    await listBriefings("user-1");
    expect(not).toHaveBeenCalledWith("run_id", "is", null);
    expect(limit).toHaveBeenCalledWith(50);
  });
});

describe("getMessages", () => {
  it("returns a conversation's messages oldest-first, bounded", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: "m1", role: "user", content: "hi" }],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    const rows = await getMessages("conv-1");
    expect(rows).toEqual([{ id: "m1", role: "user", content: "hi" }]);
    expect(eq).toHaveBeenCalledWith("conversation_id", "conv-1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(limit).toHaveBeenCalledWith(200);
  });
});

describe("toThreadMessages", () => {
  const ACTION = {
    kind: "create_item",
    boardId: "b1",
    groupId: "g1",
    name: "Ship v2",
    summary: 'Create task "Ship v2" in Backlog',
    warnings: [],
  };

  it("maps rows to render-ready turns with a parsed trace", () => {
    expect(
      toThreadMessages([
        {
          id: "m1",
          role: "user",
          content: "create Ship v2",
          tool_trace: null,
          agent_id: null,
          created_at: "2026-07-27T10:00:00Z",
        },
        {
          id: "m2",
          role: "assistant",
          content: "I'll create that.",
          tool_trace: { boardsConsulted: ["b1"], proposedActions: [ACTION] },
          agent_id: null,
          created_at: "2026-07-27T10:00:05Z",
        },
      ]),
    ).toEqual([
      {
        id: "m1",
        role: "user",
        content: "create Ship v2",
        trace: null,
        agentId: null,
      },
      {
        id: "m2",
        role: "assistant",
        content: "I'll create that.",
        trace: { boardsConsulted: ["b1"], proposedActions: [ACTION] },
        agentId: null,
      },
    ]);
  });

  it("degrades a malformed trace to null rather than dropping the turn", () => {
    expect(
      toThreadMessages([
        {
          id: "m1",
          role: "assistant",
          content: "hi",
          tool_trace: { proposedActions: "not-an-array" },
          agent_id: null,
          created_at: "2026-07-27T10:00:00Z",
        },
      ]),
    ).toEqual([
      {
        id: "m1",
        role: "assistant",
        content: "hi",
        trace: null,
        agentId: null,
      },
    ]);
  });
});

describe("currentPersonaFrom", () => {
  const row = (
    role: "user" | "assistant",
    agent_id: string | null,
    created_at: string,
  ) => ({
    id: `m-${created_at}`,
    role,
    content: "x",
    tool_trace: null,
    agent_id,
    created_at,
  });

  // Rewritten deliberately (2026-09-07): this used to pin the OPPOSITE
  // precedence — the last user turn beating `ai_conversations.agent_id`. That
  // rule made the header switcher a no-op on any thread with a stamped turn:
  // `setConversationAgent` writes only the column, so the next turn kept
  // routing to the old agent while the chip showed the new one.
  it("takes the conversation column over the last user turn — the switcher is authoritative", () => {
    const rows = [
      row("user", "a-ops", "2026-09-07T10:00:00Z"),
      row("assistant", "a-ops", "2026-09-07T10:00:05Z"),
    ];
    expect(currentPersonaFrom(rows, "a-fin")).toBe("a-fin");
  });

  it("falls back to the last user turn when the column carries nothing", () => {
    // The repair path: `appendUserMessage` stamps the message first and only
    // then best-effort-writes the column, so a lost write must not lose the
    // agent the turn actually addressed.
    expect(currentPersonaFrom([row("user", "a-ops", "t")], null)).toBe("a-ops");
  });

  it("still answers the column when no user turn carries one", () => {
    expect(currentPersonaFrom([row("user", null, "t")], "a-ops")).toBe("a-ops");
  });

  it("is null when neither has one", () => {
    expect(currentPersonaFrom([], null)).toBeNull();
  });

  // Rewritten deliberately (2026-09-07): this used to scan PAST a null user
  // turn to an older stamped one, which was necessary only while the message
  // beat the column. Now the column is read first, so a null on the newest
  // user turn is meaningful: it is the thread that was handed back to the
  // plain assistant from the header. Scanning past it would resurrect the old
  // agent and make the escape hatch impossible — the exact bug this rule fixes.
  it("keeps a cleared persona cleared: the newest user turn's null is the answer", () => {
    const rows = [
      row("user", "a-ops", "2026-09-07T10:00:00Z"),
      row("assistant", "a-ops", "2026-09-07T10:00:05Z"),
      row("user", null, "2026-09-07T10:01:00Z"),
    ];
    expect(currentPersonaFrom(rows, null)).toBeNull();
  });

  it("ignores assistant turns when falling back", () => {
    const rows = [
      row("user", "a-ops", "2026-09-07T10:00:00Z"),
      row("assistant", null, "2026-09-07T10:00:05Z"),
    ];
    expect(currentPersonaFrom(rows, null)).toBe("a-ops");
  });
});

describe("toThreadMessages", () => {
  it("carries the answering agent onto the render shape", () => {
    const [m] = toThreadMessages([
      {
        id: "m1",
        role: "assistant",
        content: "hi",
        tool_trace: null,
        agent_id: "a-ops",
        created_at: "2026-09-07T10:00:00Z",
      },
    ]);
    expect(m.agentId).toBe("a-ops");
  });
});

describe("getConversationRunId", () => {
  function clientReturning(data: unknown, error: unknown = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });
    return { eq, maybeSingle };
  }

  it("returns the run a briefing thread reports on", async () => {
    const { eq } = clientReturning({ run_id: "run-1" });
    expect(await getConversationRunId("c1")).toBe("run-1");
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });

  it("returns null for an ordinary chat", async () => {
    clientReturning({ run_id: null });
    expect(await getConversationRunId("c1")).toBeNull();
  });

  it("degrades to null on a read failure rather than 500-ing the thread", async () => {
    // The approval cards are an addition to the page; the transcript is the
    // page. A failure here must never take the thread down with it.
    clientReturning(null, { message: "boom" });
    expect(await getConversationRunId("c1")).toBeNull();
  });
});

describe("getConversationHeader", () => {
  function clientReturning(data: unknown, error: unknown = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    return { eq, maybeSingle, select };
  }

  it("returns the row's title, agent_id and OWNER", async () => {
    const { eq, select } = clientReturning({
      title: "Q3 slippage",
      agent_id: "a-ops",
      user_id: "u-owner",
    });
    expect(await getConversationHeader("c1")).toEqual({
      title: "Q3 slippage",
      agentId: "a-ops",
      ownerId: "u-owner",
    });
    expect(eq).toHaveBeenCalledWith("id", "c1");
    // `user_id` rides along on the SAME single-row read — no second
    // round-trip — because `ai_conversations_select_board_shared` lets any
    // board member render this page, so "the page loaded" no longer means
    // "this is my thread". Drop it from the select and the read-only guard on
    // /ask/<id> silently starts offering a switcher that can never write.
    expect(select).toHaveBeenCalledWith("title, agent_id, user_id");
  });

  it("returns nulls when the row has no title or agent_id", async () => {
    clientReturning({ title: null, agent_id: null, user_id: "u-owner" });
    expect(await getConversationHeader("c1")).toEqual({
      title: null,
      agentId: null,
      ownerId: "u-owner",
    });
  });

  it("degrades to nulls on a query error rather than throwing", async () => {
    clientReturning(null, { message: "boom" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A degraded read must fail CLOSED on the write affordances: `ownerId`
    // null matches no user, so the page renders read-only rather than handing
    // a switcher and a composer to someone whose ownership we could not
    // establish.
    expect(await getConversationHeader("c1")).toEqual({
      title: null,
      agentId: null,
      ownerId: null,
    });
    spy.mockRestore();
  });
});
