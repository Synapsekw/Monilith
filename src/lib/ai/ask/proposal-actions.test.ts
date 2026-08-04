import { describe, expect, it, vi, beforeEach } from "vitest";

const mockMaybeSingle = vi.fn();
const mockPriorLimit = vi.fn();
const mockInsertSingle = vi.fn();
const mockInsert = vi.fn(() => ({
  select: () => ({ single: mockInsertSingle }),
}));
const mockExecuteAction = vi.fn();
const mockGetAiEntitlement = vi.fn();

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
// select→eq→eq→(maybeSingle | limit) covers BOTH reads: the proposal row and
// the idempotency probe.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: mockMaybeSingle, limit: mockPriorLimit }),
        }),
      }),
      insert: mockInsert,
    }),
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
