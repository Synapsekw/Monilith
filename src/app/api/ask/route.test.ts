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
vi.mock("@/lib/ai/ask/ask-stream", () => ({
  askPulseStream: vi.fn(
    async ({ emit }: { emit: (e: { type: string; text: string }) => void }) => {
      emit({ type: "token", text: "Hi" });
      return {
        answer: "Hi",
        boardsConsulted: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  ),
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
      insert: () => ({ select: () => ({ single }) }),
      update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
    }),
  })),
}));

import { POST } from "./route";

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

  it("auto-titles on the first exchange", async () => {
    const res = await POST(makeReq());
    const text = await res.text();
    expect(text).toMatch(/"type":"done"/);
    expect(text).toContain('"title":"Overdue items"');
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
