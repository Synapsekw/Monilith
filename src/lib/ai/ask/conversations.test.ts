import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from })),
}));

import {
  listConversations,
  getMessages,
  getConversationRunId,
  getConversationPersona,
  toThreadMessages,
  currentPersonaFrom,
} from "./conversations";

beforeEach(() => from.mockReset());

describe("listConversations", () => {
  it("returns the user's conversations newest-first, bounded", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "c1", title: "A" }], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    const rows = await listConversations("user-1");
    expect(rows).toEqual([{ id: "c1", title: "A" }]);
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(100);
  });

  it("throws when the query errors", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    await expect(listConversations("u")).rejects.toThrow("listConversations");
  });

  it("lists a board thread in the rail alongside plain /ask threads", async () => {
    // Deliberate: a board thread is still the user's own conversation. The rail
    // filters on user_id and nothing else, so scoping a thread to a board does
    // not hide it from /ask. Do not add a `.is("board_id", null)` filter here.
    const limit = vi.fn().mockResolvedValue({
      data: [
        { id: "c1", title: "Plain ask", updated_at: "2026-08-03T10:00:00Z" },
        {
          id: "c2",
          title: "About the roadmap",
          updated_at: "2026-08-03T09:00:00Z",
        },
      ],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    const rows = await listConversations("user-1");

    expect(rows).toHaveLength(2);
    // The only scoping filter is user_id — no board_id filter is applied.
    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
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

  it("takes the LAST user turn's agent, not the conversation column", () => {
    const rows = [
      row("user", "a-ops", "2026-09-07T10:00:00Z"),
      row("assistant", "a-ops", "2026-09-07T10:00:05Z"),
      row("user", "a-fin", "2026-09-07T10:01:00Z"),
    ];
    expect(currentPersonaFrom(rows, "a-ops")).toBe("a-fin");
  });

  it("falls back to the conversation column when no user turn carries one", () => {
    expect(currentPersonaFrom([row("user", null, "t")], "a-ops")).toBe("a-ops");
  });

  it("is null when neither has one", () => {
    expect(currentPersonaFrom([], null)).toBeNull();
  });

  it("skips a null-agent user turn and keeps scanning back to an earlier one", () => {
    // Intentional: a null on the LAST user turn does not mean "no persona" —
    // it means "this particular turn didn't carry one" (e.g. written before
    // per-message routing existed). The scan keeps going back rather than
    // stopping at the first user row it sees.
    const rows = [
      row("user", "a-ops", "2026-09-07T10:00:00Z"),
      row("user", null, "2026-09-07T10:01:00Z"),
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

describe("getConversationPersona", () => {
  function clientReturning(data: unknown, error: unknown = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });
    return { eq, maybeSingle };
  }

  it("returns the row's agent_id", async () => {
    const { eq } = clientReturning({ agent_id: "a-ops" });
    expect(await getConversationPersona("c1")).toBe("a-ops");
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });

  it("returns null when the row has no agent_id", async () => {
    clientReturning({ agent_id: null });
    expect(await getConversationPersona("c1")).toBeNull();
  });

  it("degrades to null on a query error rather than throwing", async () => {
    clientReturning(null, { message: "boom" });
    expect(await getConversationPersona("c1")).toBeNull();
  });
});
