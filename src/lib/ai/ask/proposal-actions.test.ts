import { describe, expect, it, vi, beforeEach } from "vitest";

const mockMaybeSingle = vi.fn();
const mockPriorLimit = vi.fn();
const mockInsertSingle = vi.fn();
const mockInsert = vi.fn(() => ({
  select: () => ({ single: mockInsertSingle }),
}));
const mockExecuteAction = vi.fn();
const mockGetAiEntitlement = vi.fn();
// `ai_conversations.agent_id` — what `currentPersonaFrom` reads FIRST (the
// header switcher writes only this column); the thread's newest user turn is
// the fallback for a lost column write.
const mockConvMaybeSingle = vi.fn();
// The thread's rows, as `resolvePersonaAgentId` reads them via the REAL
// `getMessages` (only ITS supabase call is mocked — see below).
const mockGetMessages = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1" })),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => ({ id: "org1" })),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  getAiEntitlement: (...a: unknown[]) => mockGetAiEntitlement(...a),
}));
vi.mock("@/lib/ai/write/execute", () => ({
  executeAction: (...a: unknown[]) => mockExecuteAction(...a),
}));
// `currentPersonaFrom` is kept REAL (not mocked) — this is a regression test
// for `resolvePersonaAgentId` correctly threading that real resolution into
// the insert, not for the algorithm itself (that's `conversations.test.ts`).
// Only `getMessages` is stubbed, since it does its own DB round-trip.
vi.mock("@/lib/ai/ask/conversations", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ai/ask/conversations")>();
  return { ...actual, getMessages: (...a: unknown[]) => mockGetMessages(...a) };
});
// `from("ai_messages")`: select→eq→eq→(maybeSingle | limit) covers BOTH reads
// the proposal itself needs — the proposal row and the idempotency probe.
// `from("ai_conversations")`: select→eq→maybeSingle is the persona fallback
// read `resolvePersonaAgentId` added.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "ai_conversations") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: mockConvMaybeSingle }) }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: mockMaybeSingle, limit: mockPriorLimit }),
          }),
        }),
        insert: mockInsert,
      };
    },
  }),
}));

import { applyAskProposal, cancelAskProposal } from "./proposal-actions";

const CONV = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const ACTION = {
  kind: "create_item",
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAiEntitlement.mockResolvedValue({ mode: "managed" });
  mockMaybeSingle.mockResolvedValue({
    data: { tool_trace: { proposedActions: [ACTION] } },
    error: null,
  });
  mockPriorLimit.mockResolvedValue({ data: [], error: null });
  mockInsertSingle.mockResolvedValue({ data: { id: "o1" }, error: null });
  // Default: no persona anywhere in the thread — matches the pre-fix behavior
  // for every test below that doesn't care about attribution.
  mockConvMaybeSingle.mockResolvedValue({
    data: { agent_id: null },
    error: null,
  });
  mockGetMessages.mockResolvedValue([]);
  mockExecuteAction.mockResolvedValue({
    result: { ok: true, itemId: "i1" },
    effect: {
      kind: "item_created",
      boardId: "b1",
      item: { id: "i1", board_id: "b1", group_id: "g1" },
      cells: [],
    },
  });
});

describe("applyAskProposal", () => {
  it("rejects non-uuid ids before touching the database", async () => {
    const res = await applyAskProposal({ conversationId: "x", messageId: MSG });
    expect(res.ok).toBe(false);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it("refuses when the org has AI turned off", async () => {
    mockGetAiEntitlement.mockResolvedValue({ mode: "off" });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it("fails when RLS returns no row (a foreign or missing message)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not found/i);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it("fails when the trace carries no proposals", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { tool_trace: { boardsConsulted: [] } },
      error: null,
    });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it("refuses a second apply (two tabs / double click)", async () => {
    mockPriorLimit.mockResolvedValue({ data: [{ id: "o0" }], error: null });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/already resolved/i);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it("executes the action read FROM THE DATABASE and appends an outcome turn", async () => {
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(mockExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "create_item", name: "Ship v2" }),
    );
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: CONV,
        role: "assistant",
        tool_trace: expect.objectContaining({
          resolvesProposal: MSG,
          outcome: "applied",
          results: [{ ok: true, itemId: "i1" }],
        }),
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.messageId).toBe("o1");
      expect(res.data.content).toContain("Ship v2");
    }
  });

  it("hands the effects back on the outcome without persisting them", async () => {
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.effects).toHaveLength(1);
    expect(res.data.effects[0]?.kind).toBe("item_created");
    // The persisted trace carries results ONLY — never rows. tool_trace is read
    // back on every thread open, so a row in there would replay stale state.
    expect(res.data.trace).not.toHaveProperty("effects");
    expect(JSON.stringify(res.data.trace)).not.toContain("item_created");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_trace: expect.not.objectContaining({ effects: expect.anything() }),
      }),
    );
  });

  it("carries no effects when nothing produced rows", async () => {
    mockExecuteAction.mockResolvedValue({
      result: { ok: false, error: "No date column." },
      effect: null,
    });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.effects).toEqual([]);
  });

  it("records a failed execution instead of claiming success", async () => {
    mockExecuteAction.mockResolvedValue({
      result: { ok: false, error: "No date column." },
      effect: null,
    });
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true); // the attempt was recorded
    if (res.ok) expect(res.data.content).toContain("No date column.");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_trace: expect.objectContaining({
          results: [{ ok: false, error: "No date column." }],
        }),
      }),
    );
  });
});

describe("cancelAskProposal", () => {
  it("appends a cancelled outcome and never executes", async () => {
    const res = await cancelAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(mockExecuteAction).not.toHaveBeenCalled();
    // A cancel changes nothing, so it carries no effects.
    if (res.ok) expect(res.data.effects).toEqual([]);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Cancelled — nothing was changed.",
        tool_trace: expect.objectContaining({
          resolvesProposal: MSG,
          outcome: "cancelled",
        }),
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("works even when AI is turned off (nothing is spent and nothing is written)", async () => {
    mockGetAiEntitlement.mockResolvedValue({ mode: "off" });
    const res = await cancelAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true);
  });

  it("refuses to cancel a proposal that was already resolved", async () => {
    mockPriorLimit.mockResolvedValue({ data: [{ id: "o0" }], error: null });
    const res = await cancelAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(false);
  });
});

// Regression: the outcome row used to be inserted with NO `agent_id` column
// at all, so it landed NULL regardless of who actually answered. The client's
// optimistic label (AskChat's `personaId` stamp) kept the SESSION looking
// right, but a reload reads this row straight off the DB — so the row itself,
// not just the rendered label, is what these tests pin.
describe("applyAskProposal / cancelAskProposal — persist who answered", () => {
  it("writes the last user turn's agent_id on the outcome row", async () => {
    const AGENT_ID = "33333333-3333-4333-8333-333333333333";
    mockGetMessages.mockResolvedValue([
      {
        id: "u1",
        role: "user",
        content: "@ops go",
        tool_trace: null,
        created_at: "t",
        agent_id: AGENT_ID,
      },
    ]);
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: AGENT_ID }),
    );
  });

  // Retitled deliberately (2026-09-07): the column no longer wins only "when
  // no user turn carries one" — it wins, full stop. The assertion is unchanged.
  it("writes the conversation's own agent_id — the column the switcher sets", async () => {
    const AGENT_ID = "44444444-4444-4444-8444-444444444444";
    mockConvMaybeSingle.mockResolvedValue({
      data: { agent_id: AGENT_ID },
      error: null,
    });
    const res = await cancelAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: AGENT_ID }),
    );
  });

  it("writes null — not undefined, not omitted — when the thread has no persona at all", async () => {
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: null }),
    );
  });

  it("takes the conversation column over a stamped user turn", async () => {
    const SWITCHED_IN = "55555555-5555-4555-8555-555555555555";
    mockConvMaybeSingle.mockResolvedValue({
      data: { agent_id: SWITCHED_IN },
      error: null,
    });
    mockGetMessages.mockResolvedValue([
      {
        id: "u1",
        role: "user",
        content: "@ops go",
        tool_trace: null,
        created_at: "t",
        agent_id: "66666666-6666-4666-8666-666666666666",
      },
    ]);
    const res = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(res.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: SWITCHED_IN }),
    );
  });

  // The outcome turn was attributed TWICE by two different rules — the server
  // stamped the persisted row, the client stamped its own copy from whatever
  // persona it happened to be holding. They disagree after a switch, and the
  // reload relabelled the turn. The server's answer is now returned, so the
  // client has one to use instead of a guess of its own.
  it("returns the agent it stamped, so the client never has to guess", async () => {
    const AGENT_ID = "77777777-7777-4777-8777-777777777777";
    mockConvMaybeSingle.mockResolvedValue({
      data: { agent_id: AGENT_ID },
      error: null,
    });
    const applied = await applyAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    const cancelled = await cancelAskProposal({
      conversationId: CONV,
      messageId: MSG,
    });
    expect(applied.ok && applied.data.agentId).toBe(AGENT_ID);
    expect(cancelled.ok && cancelled.data.agentId).toBe(AGENT_ID);
  });
});
