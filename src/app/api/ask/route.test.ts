import { describe, expect, it, vi, beforeEach } from "vitest";

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
        adapter: { supportsTools: boolean };
      }) => Promise<{ result: unknown; usage: unknown }>,
    ) => {
      const r = await fn({ apiKey: "k", adapter: { supportsTools: true } });
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
      a as { emit: (e: { type: string; text: string }) => void },
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
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: vi.fn(async () => ({
            data: { summary: null, summarized_upto: null },
            error: null,
          })),
        }),
      }),
      insert: insertSpy,
      update: updateSpy,
    }),
  })),
}));

import { POST } from "./route";
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
