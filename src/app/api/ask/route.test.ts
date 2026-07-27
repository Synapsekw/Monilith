import { describe, expect, it, vi, beforeEach } from "vitest";

// The Anthropic SDK refuses to construct in a "browser-like" (jsdom) env. The
// engine (askPulseStream) and title/summarize helpers are already mocked, so the
// client's methods are never called — a stub constructor is all the route needs.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {};
  },
}));

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
vi.mock("@/lib/ai/gateway", () => ({
  runAi: vi.fn(
    async (
      _a: unknown,
      fn: (r: {
        apiKey: string;
        adapter: { supportsTools: boolean };
      }) => Promise<{ result: unknown }>,
    ) => (await fn({ apiKey: "k", adapter: { supportsTools: true } })).result,
  ),
}));
// Explicit return type so `mockImplementationOnce` can widen the arrays (a bare
// `[]` in the default impl would infer `never[]` and reject the proposal case).
type StreamResult = {
  answer: string;
  boardsConsulted: string[];
  proposedActions: unknown[];
  usage: { inputTokens: number; outputTokens: number };
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
      update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
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

beforeEach(() => vi.clearAllMocks());

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

  it("returns 402 when entitlement throws", async () => {
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    (requireAiEntitlement as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("AiQuotaExceeded"),
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(402);
  });
});
