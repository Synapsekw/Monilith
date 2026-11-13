import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const CONV = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const BOARD = "33333333-3333-4333-8333-333333333333";

const state = {
  trace: null as unknown,
  prior: false,
  ownerId: "u-1",
  mode: "per_user" as string,
  inserted: [] as { tool_trace: Record<string, unknown>; content: string }[],
};

function q(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "limit", "select"]) c[m] = () => c;
  c.maybeSingle = async () => result;
  c.single = async () => result;
  c.then = (resolve: (v: unknown) => void) => resolve(result);
  return c;
}

const supabase = {
  from: (table: string) => {
    if (table === "ai_conversations")
      return {
        select: () => q({ data: { user_id: state.ownerId }, error: null }),
      };
    return {
      select: (cols: string) =>
        cols === "id"
          ? q({ data: state.prior ? [{ id: "x" }] : [], error: null })
          : q({
              data: { tool_trace: state.trace, agent_id: null },
              error: null,
            }),
      insert: (row: {
        tool_trace: Record<string, unknown>;
        content: string;
      }) => {
        state.inserted.push(row);
        return q({ data: { id: "out-1" }, error: null });
      },
    };
  },
};

const invoke = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u-1" }),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => ({ id: "o-1" }),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  getAiEntitlement: async () => ({ mode: state.mode }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabase,
}));
vi.mock("./catalog", () => ({
  findDescriptor: (name: string) =>
    name === "update_item"
      ? {
          name,
          inputSchema: { itemId: z.string() },
          capability: "board.write",
          invoke,
        }
      : undefined,
}));

import { applyBatch, dismissBatch } from "./batch-actions";

const call = (id: string, over: object = {}) => ({
  id,
  tool: "update_item",
  input: { itemId: "i-1" },
  summary: `Change ${id}`,
  destructive: false,
  boardId: BOARD,
  ...over,
});

beforeEach(() => {
  state.trace = { stagedCalls: [call("a"), call("b")] };
  state.prior = false;
  state.ownerId = "u-1";
  state.mode = "per_user";
  state.inserted = [];
  invoke.mockReset();
  invoke.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
});

describe("applyBatch", () => {
  it("runs only the selected rows and records a result per row", async () => {
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(res.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(state.inserted[0]!.tool_trace).toMatchObject({
      resolvesProposal: MSG,
      outcome: "applied",
      stagedResults: [
        { id: "a", ok: true },
        { id: "b", ok: false, skipped: true },
      ],
    });
    if (res.ok) expect(res.data.touchedBoardIds).toEqual([BOARD]);
  });

  it("keeps going when one row fails", async () => {
    invoke.mockResolvedValueOnce({
      content: [{ type: "text", text: "Item not found." }],
      isError: true,
    });
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a", "b"],
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(state.inserted[0]!.tool_trace.stagedResults).toEqual([
      { id: "a", ok: false, error: "Item not found." },
      { id: "b", ok: true },
    ]);
    expect(state.inserted[0]!.content).toContain(
      "Failed — Change a: Item not found.",
    );
    expect(res.ok).toBe(true);
  });

  it("fails a row whose stored input no longer validates, without invoking", async () => {
    state.trace = { stagedCalls: [call("a", { input: { itemId: 5 } })] };
    await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(state.inserted[0]!.tool_trace.stagedResults).toEqual([
      { id: "a", ok: false, error: "This change is no longer valid." },
    ]);
  });

  it("fails a row that names an unknown tool", async () => {
    state.trace = { stagedCalls: [call("a", { tool: "gone_tool" })] };
    await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses a batch that was already resolved", async () => {
    state.prior = true;
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(res.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses someone else's conversation", async () => {
    state.ownerId = "u-2";
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(res.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses when AI is off for the org", async () => {
    state.mode = "off";
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(res.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses an empty selection", async () => {
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: [],
    });
    expect(res.ok).toBe(false);
  });
});

describe("dismissBatch", () => {
  it("records a cancelled outcome and runs nothing", async () => {
    const res = await dismissBatch({ conversationId: CONV, messageId: MSG });
    expect(res.ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(state.inserted[0]!.tool_trace).toMatchObject({
      resolvesProposal: MSG,
      outcome: "cancelled",
    });
  });
});
