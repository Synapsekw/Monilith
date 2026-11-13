import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const CONV = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const BOARD = "33333333-3333-4333-8333-333333333333";

const OTHER_CONV = "44444444-4444-4444-8444-444444444444";

const state = {
  trace: null as unknown,
  prior: false,
  priorError: false,
  insertError: false,
  ownerId: "u-1",
  convOrg: "o-1",
  msgConv: CONV,
  mode: "per_user" as string,
  inserted: [] as { tool_trace: Record<string, unknown>; content: string }[],
};

type Eqs = Record<string, unknown>;

/** Query fake that records eq(column, value) pairs and answers by them. */
function q(answer: (eqs: Eqs) => unknown) {
  const eqs: Eqs = {};
  const c: Record<string, unknown> = {};
  c.eq = (col: string, val: unknown) => {
    eqs[col] = val;
    return c;
  };
  c.limit = () => c;
  c.select = () => c;
  c.maybeSingle = async () => answer(eqs);
  c.single = async () => answer(eqs);
  c.then = (resolve: (v: unknown) => void) => resolve(answer(eqs));
  return c;
}

const supabase = {
  from: (table: string) => {
    if (table === "ai_conversations")
      return {
        select: () =>
          q((eqs) =>
            eqs.id === CONV
              ? {
                  data: { user_id: state.ownerId, org_id: state.convOrg },
                  error: null,
                }
              : { data: null, error: null },
          ),
      };
    return {
      select: (cols: string) =>
        cols === "id"
          ? q((eqs) =>
              state.priorError
                ? { data: null, error: { message: "boom" } }
                : eqs.conversation_id === CONV &&
                    eqs["tool_trace->>resolvesProposal"] === MSG &&
                    state.prior
                  ? { data: [{ id: "x" }], error: null }
                  : { data: [], error: null },
            )
          : q((eqs) =>
              eqs.id === MSG && eqs.conversation_id === state.msgConv
                ? {
                    data: { tool_trace: state.trace, agent_id: null },
                    error: null,
                  }
                : { data: null, error: null },
            ),
      insert: (row: {
        tool_trace: Record<string, unknown>;
        content: string;
      }) => {
        state.inserted.push(row);
        return q(() =>
          state.insertError
            ? { data: null, error: { message: "nope" } }
            : { data: { id: "out-1" }, error: null },
        );
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
  state.priorError = false;
  state.insertError = false;
  state.convOrg = "o-1";
  state.msgConv = CONV;
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

describe("applyBatch hardening", () => {
  const args = { conversationId: CONV, messageId: MSG, selectedIds: ["a"] };

  it("fails closed when the already-resolved check errors", async () => {
    state.priorError = true;
    const res = await applyBatch(args);
    expect(res.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses a message that belongs to a different conversation", async () => {
    state.msgConv = OTHER_CONV;
    const res = await applyBatch(args);
    expect(res.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses a conversation in another org", async () => {
    state.convOrg = "o-2";
    const res = await applyBatch(args);
    expect(res.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stores a generic error when a tool throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error("secret db detail"));
    await applyBatch(args);
    expect(state.inserted[0]!.tool_trace.stagedResults).toEqual([
      { id: "a", ok: false, error: "Failed." },
      { id: "b", ok: false, skipped: true },
    ]);
    expect(JSON.stringify(state.inserted[0])).not.toContain("secret db detail");
    spy.mockRestore();
  });

  it("runs only the first of duplicate staged ids", async () => {
    state.trace = { stagedCalls: [call("a"), call("a")] };
    await applyBatch(args);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(state.inserted[0]!.tool_trace.stagedResults).toEqual([
      { id: "a", ok: true },
      { id: "a", ok: false, skipped: true },
    ]);
  });

  it("says there is nothing to apply for an unparsable trace", async () => {
    state.trace = "garbage";
    const res = await applyBatch(args);
    expect(res).toMatchObject({
      ok: false,
      error: "That turn has nothing to apply.",
    });
    state.trace = {};
    const res2 = await applyBatch(args);
    expect(res2.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails when the outcome insert fails", async () => {
    state.insertError = true;
    const res = await applyBatch(args);
    expect(res.ok).toBe(false);
  });
});

describe("dismissBatch", () => {
  const args = { conversationId: CONV, messageId: MSG };

  it("refuses a non-owner", async () => {
    state.ownerId = "u-2";
    const res = await dismissBatch(args);
    expect(res.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses an already-resolved batch", async () => {
    state.prior = true;
    const res = await dismissBatch(args);
    expect(res.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses a conversation in another org", async () => {
    state.convOrg = "o-2";
    const res = await dismissBatch(args);
    expect(res.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
  });

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
