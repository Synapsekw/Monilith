import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";

// The Anthropic SDK refuses to construct in a "browser-like" (jsdom) env. The
// engine (askPulseStream) and title/summarize helpers are already mocked, so the
// client's methods are never called — a stub constructor is all the route needs.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {};
  },
}));

// `after` throws outside a Next request scope, so a direct POST() call in a unit
// test can never run the real one. Capturing the tasks is also the assertion
// that the turn is handed to the platform's keep-alive (gotcha-62).
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as unknown[] }));
vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return { ...actual, after: (task: unknown) => void afterTasks.push(task) };
});

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1" })),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => ({ id: "org1" })),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => [{ id: "ws1" }]),
}));
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: vi.fn(async () => "ws1"),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: vi.fn(async () => undefined),
}));
// Mirrors the real chokepoint: usage is recorded AFTER fn resolves, so
// `meteredSpy` standing in for `record_ai_usage` is the billing assertion.
const { meteredSpy } = vi.hoisted(() => ({ meteredSpy: vi.fn() }));
vi.mock("@/lib/ai/gateway", () => ({
  runAi: vi.fn(
    async (
      _a: unknown,
      fn: (r: {
        apiKey: string;
        provider: string;
        model: ReturnType<typeof fakeResolvedModel>;
      }) => Promise<{ result: unknown; usage: unknown }>,
    ) => {
      const r = await fn({
        apiKey: "k",
        provider: "anthropic",
        model: fakeResolvedModel(),
      });
      meteredSpy(r.usage);
      return r.result;
    },
  ),
}));
// Explicit return type so `mockImplementationOnce` can widen the arrays (a bare
// `[]` in the default impl would infer `never[]` and reject the proposal case).
type StreamResult = {
  answer: string;
  boardsConsulted: string[];
  proposedActions: unknown[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};
const askPulseStreamMock = vi.fn(
  async ({
    emit,
  }: {
    emit: (e: { type: string; text: string }) => void;
    system: string;
  }): Promise<StreamResult> => {
    emit({ type: "token", text: "Hi" });
    return {
      answer: "Hi",
      boardsConsulted: [],
      proposedActions: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
);
vi.mock("@/lib/ai/ask/ask-stream", () => ({
  askPulseStream: (a: unknown) =>
    askPulseStreamMock(
      a as {
        emit: (e: { type: string; text: string }) => void;
        system: string;
      },
    ),
}));
vi.mock("@/lib/profile/queries-cached", () => ({
  getUserTimeZoneCached: vi.fn(async () => "Europe/Berlin"),
}));
vi.mock("@/lib/ai/ask/conversations", () => ({
  getMessages: vi.fn(async () => [
    {
      id: "m1",
      role: "user",
      content: "hi",
      tool_trace: null,
      created_at: "t",
    },
  ]),
}));
vi.mock("@/lib/ai/ask/context", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ai/ask/context")>();
  return {
    ...actual,
    generateTitle: vi.fn(async () => ({
      title: "Overdue items",
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
  };
});

// conversation fetch + assistant insert + title update via a chained mock client
const single = vi.fn(async () => ({ data: { id: "a1" }, error: null }));
const insertSpy = vi.fn(() => ({ select: () => ({ single }) }));
const updateSpy = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));

const USER_ID = "u1"; // matches the requireUser mock above.

type ConversationRow = {
  summary: string | null;
  summarized_upto: string | null;
  board_id: string | null;
  agent_id: string | null;
  user_id: string;
};
const defaultConversationRow = (): ConversationRow => ({
  summary: null,
  summarized_upto: null,
  board_id: null,
  agent_id: null,
  user_id: USER_ID,
});
let conversationRow: { data: ConversationRow | null; error: unknown } = {
  data: defaultConversationRow(),
  error: null,
};
let agentRow: {
  data: { name: string; instructions: string } | null;
  error: unknown;
} = { data: null, error: null };
let boardRow: { data: { id: string; name: string } | null; error: unknown } = {
  data: null,
  error: null,
};

/** Overrides the conversation row `ai_conversations` reads back for the next
 *  POST. `user_id` defaults to the caller so existing tests keep passing the
 *  owner gate without having to know it exists. */
function mockConversationRow(overrides: Partial<ConversationRow>) {
  conversationRow = {
    data: { ...defaultConversationRow(), ...overrides },
    error: null,
  };
}
/** Overrides the `user_agents` row the route reads back for `agent_id`. Pass
 *  `null` to simulate a dangling/unreadable agent id. */
function mockAgentRow(row: { name: string; instructions: string } | null) {
  agentRow = { data: row, error: null };
}
/** Overrides the `boards` row the route reads back for `board_id`. Pass
 *  `null` to simulate an RLS-invisible or dangling board id. */
function mockBoardRow(row: { id: string; name: string } | null) {
  boardRow = { data: row, error: null };
}

// Table-routed, because the route now reads three different tables through the
// same client: ai_conversations (owner gate + persona/board ids), boards and
// user_agents (persona/board lookups, via maybeSingle so a missing row is not
// an error), and ai_messages (the assistant insert).
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "ai_conversations") {
        return {
          select: () => ({
            eq: () => ({ single: vi.fn(async () => conversationRow) }),
          }),
          update: updateSpy,
        };
      }
      if (table === "ai_messages") {
        return { insert: insertSpy };
      }
      if (table === "boards") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: vi.fn(async () => boardRow) }),
          }),
        };
      }
      if (table === "user_agents") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: vi.fn(async () => agentRow) }),
          }),
        };
      }
      throw new Error(`unmocked table in test double: ${table}`);
    },
  })),
}));

import { POST } from "./route";
import { runAi } from "@/lib/ai/gateway";
import { OPENING_STATUS } from "@/lib/ai/ask/stream-protocol";

const CONV_ID = "11111111-1111-4111-8111-111111111111";
const makeReq = () =>
  new Request("http://x/api/ask", {
    method: "POST",
    body: JSON.stringify({ conversationId: CONV_ID }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  conversationRow = { data: defaultConversationRow(), error: null };
  agentRow = { data: null, error: null };
  boardRow = { data: null, error: null };
});

describe("POST /api/ask", () => {
  it("streams tokens then a done event with the assistant message id", async () => {
    const res = await POST(makeReq());
    const text = await res.text();
    expect(text).toContain('"type":"token"');
    expect(text).toContain('"type":"done"');
    expect(text).toContain('"assistantMessageId":"a1"');
  });

  // gotcha-62: statuses only ever appeared AFTER a tool round completed, so the
  // opening 25–42s of a turn carried no server signal at all.
  it("opens the turn with a status event, before any token", async () => {
    const res = await POST(makeReq());
    const events = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; text?: string });

    expect(events[0]).toEqual({ type: "status", text: OPENING_STATUS });
    expect(events.findIndex((e) => e.type === "status")).toBeLessThan(
      events.findIndex((e) => e.type === "token"),
    );
  });

  it("auto-titles on the first exchange", async () => {
    const res = await POST(makeReq());
    const text = await res.text();
    expect(text).toMatch(/"type":"done"/);
    expect(text).toContain('"title":"Overdue items"');
  });

  // The persistence work lives in the ReadableStream's `start()`, which only
  // runs once the body is consumed — so every insert assertion drains it first.
  const post = async () => {
    await (await POST(makeReq())).text();
  };

  it("persists boardsConsulted with no proposals on a read-only turn", async () => {
    await post();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        tool_trace: { boardsConsulted: [] },
      }),
    );
  });

  it("persists proposedActions into tool_trace on a proposal turn", async () => {
    const action = {
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "Ship v2",
      summary: 'Create task "Ship v2" in Backlog',
      warnings: [],
    };
    askPulseStreamMock.mockImplementationOnce(async ({ emit }) => {
      emit({ type: "token", text: "I'll create that — " });
      return {
        answer: "I'll create that — ",
        boardsConsulted: ["b1"],
        proposedActions: [action],
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });
    await post();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_trace: { boardsConsulted: ["b1"], proposedActions: [action] },
      }),
    );
  });

  // Once caching engages, Anthropic's input_tokens is the UNCACHED remainder
  // only — a 26k-token turn reports ~2k input_tokens + ~24k
  // cache_read_input_tokens. Dropping the cache fields on the way to the
  // ledger would under-bill the org by the entire cached prefix.
  it("forwards cacheReadTokens/cacheWriteTokens from askPulseStream to the metering call", async () => {
    askPulseStreamMock.mockImplementationOnce(async ({ emit }) => {
      emit({ type: "token", text: "Hi" });
      return {
        answer: "Hi",
        boardsConsulted: [],
        proposedActions: [],
        usage: {
          inputTokens: 2_000,
          outputTokens: 50,
          cacheReadTokens: 24_000,
          cacheWriteTokens: 1_500,
        },
      };
    });
    await post();
    expect(meteredSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheReadTokens: 24_000,
        cacheWriteTokens: 1_500,
      }),
    );
  });

  it("returns 402 when entitlement throws", async () => {
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    (requireAiEntitlement as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("AiQuotaExceeded"),
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(402);
  });
});

// gotcha-62: the turn used to live inside the response body's lifetime, so a
// reload / RSC navigation cancelled the stream, the next enqueue threw, and the
// turn died before it persisted OR billed — model work already paid for
// upstream, lost. The turn must now outlive the reader.
describe("POST /api/ask · client disconnect", () => {
  /** Drive a turn until the engine is mid-flight, then sever the body. Returns
   *  `release`, which lets the now client-less turn run to completion. */
  async function severMidTurn(
    result: Partial<StreamResult> = {},
  ): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const enteredEngine = new Promise<void>((r) => (entered = r));

    askPulseStreamMock.mockImplementationOnce(async ({ emit }) => {
      entered();
      await held;
      // The first write after the client is gone — this is what used to throw.
      emit({ type: "token", text: "Hi" });
      return {
        answer: "Hi",
        boardsConsulted: [],
        proposedActions: [],
        usage: { inputTokens: 3, outputTokens: 5 },
        ...result,
      };
    });

    const res = await POST(makeReq());
    const reader = res.body!.getReader();
    await reader.read(); // the opening status byte
    await enteredEngine;
    await reader.cancel(); // the browser goes away mid-turn
    return release;
  }

  it("persists the assistant message after the reader cancels mid-stream", async () => {
    const release = await severMidTurn();
    release();
    await vi.waitFor(() =>
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: "assistant", content: "Hi" }),
      ),
    );
  });

  it("still meters usage after the reader cancels mid-stream", async () => {
    const release = await severMidTurn();
    release();
    await vi.waitFor(() =>
      expect(meteredSpy).toHaveBeenCalledWith(
        expect.objectContaining({ inputTokens: expect.any(Number) }),
      ),
    );
  });

  it("persists a proposal turn's confirm card after a disconnect", async () => {
    const action = {
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "Ship v2",
      summary: 'Create task "Ship v2" in Backlog',
      warnings: [],
    };
    const release = await severMidTurn({
      boardsConsulted: ["b1"],
      proposedActions: [action],
    });
    release();
    await vi.waitFor(() =>
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_trace: { boardsConsulted: ["b1"], proposedActions: [action] },
        }),
      ),
    );
  });

  it("still auto-titles the conversation after a disconnect", async () => {
    const release = await severMidTurn();
    release();
    await vi.waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({ title: "Overdue items" }),
    );
  });

  it("hands the turn to after() so the platform keeps the invocation alive", async () => {
    await (await POST(makeReq())).text();
    expect(afterTasks).toHaveLength(1);
  });
});

// Task 4: the conversation row — not the request body — is now the source of
// the board and agent ids for a turn, so ownership and persona composition are
// asserted against `ai_conversations`, `boards` and `user_agents` reads.
describe("POST /api/ask · ownership, persona, and board scope", () => {
  const BOARD_ID = "board-1";
  const AGENT_ID = "agent-1";
  const SOMEONE_ELSE_ID = "u2";

  it("refuses a turn on a conversation the caller does not own", async () => {
    // A board member can READ a shared thread, but a turn spends the OWNER's
    // tokens and appends to their thread. Without this gate, read access to a
    // shared thread would be a licence to bill its owner.
    mockConversationRow({
      board_id: BOARD_ID,
      agent_id: null,
      user_id: SOMEONE_ELSE_ID,
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect(runAi).not.toHaveBeenCalled();
  });

  it("composes the agent persona into the system prompt for an agent thread", async () => {
    mockConversationRow({ board_id: null, agent_id: AGENT_ID });
    mockAgentRow({ name: "Morning Brief", instructions: "Focus on blockers." });
    // The persona is composed before the turn's async work runs; draining the
    // body is what synchronizes the test with that turn, same as the other
    // assertions on askPulseStreamMock's calls in this file.
    await (await POST(makeReq())).text();
    const system = askPulseStreamMock.mock.calls[0][0].system as string;
    expect(system).toContain("<agent_instructions>");
    expect(system).toContain("Focus on blockers.");
  });

  it("composes the board scope into the system prompt for a board thread", async () => {
    // This wiring (route.ts, the `if (conv.data.board_id)` branch) had zero
    // coverage before: no test set `boardRow` or asserted on the composed
    // system prompt, so the branch could be deleted and every test here would
    // still pass.
    mockConversationRow({ board_id: BOARD_ID, agent_id: null });
    mockBoardRow({ id: BOARD_ID, name: "Roadmap" });
    await (await POST(makeReq())).text();
    const system = askPulseStreamMock.mock.calls[0][0].system as string;
    expect(system).toContain(BOARD_ID);
    expect(system).toContain("Roadmap");
  });

  it("meters a dock turn as ask_pulse, never against the agent run cap", async () => {
    // max_agent_runs_per_user_per_day bounds UNATTENDED spend. Charging
    // conversation against it would let an afternoon of chat silently cancel
    // tomorrow's briefing.
    mockConversationRow({ board_id: BOARD_ID, agent_id: AGENT_ID });
    mockAgentRow({ name: "Morning Brief", instructions: "Focus on blockers." });
    await (await POST(makeReq())).text();
    expect(runAi).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "ask_pulse" }),
      expect.any(Function),
    );
  });

  it("ignores an agent the caller cannot read and still runs the turn", async () => {
    // agent_id survives a deletion race as a dangling value only until the FK's
    // ON DELETE SET NULL lands. A row we cannot read must degrade to plain Ask,
    // not fail the turn — the thread's history is still worth continuing.
    mockConversationRow({ board_id: null, agent_id: AGENT_ID });
    mockAgentRow(null);
    await (await POST(makeReq())).text();
    const system = askPulseStreamMock.mock.calls[0][0].system as string;
    expect(system).not.toContain("<agent_instructions>");
  });
});
