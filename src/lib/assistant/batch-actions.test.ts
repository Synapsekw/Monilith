import { describe, it, expect, vi, beforeEach } from "vitest";
import * as z from "zod";

const CONV = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const BOARD = "33333333-3333-4333-8333-333333333333";

const OTHER_CONV = "44444444-4444-4444-8444-444444444444";

const state = {
  trace: null as unknown,
  prior: false,
  priorError: false,
  insertError: false,
  /** Fail only the first N inserts (then succeed). */
  insertFailures: 0,
  throwOnLoad: false,
  ownerId: "u-1",
  convOrg: "o-1",
  msgConv: CONV,
  mode: "per_user" as string,
  monoId: null as string | null,
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
    if (state.throwOnLoad) throw new Error("transport down");
    if (table === "ai_conversations")
      return {
        select: () =>
          q((eqs) =>
            eqs.id === CONV
              ? {
                  data: {
                    user_id: state.ownerId,
                    org_id: state.convOrg,
                    mono_id: state.monoId,
                  },
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
                    data: { tool_trace: state.trace },
                    error: null,
                  }
                : { data: null, error: null },
            ),
      insert: (row: {
        tool_trace: Record<string, unknown>;
        content: string;
      }) => {
        state.inserted.push(row);
        const failThis = state.insertError || state.insertFailures-- > 0;
        return q(() =>
          failThis
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
      : name === "manage_goal"
        ? {
            name,
            inputSchema: {
              action: z.string(),
              orgId: z.string().optional(),
            },
            capability: { create: "board.write", update: "board.write" },
            invoke,
          }
        : undefined,
}));

const loadOwnedMono = vi.fn();
const monoClient = { from: () => ({}) };
const getMonoClient = vi.fn(async (_id: string) => monoClient);
vi.mock("@/lib/monos/turn", () => ({
  loadOwnedMono: (...a: unknown[]) => loadOwnedMono(...a),
}));
vi.mock("@/lib/mono/session", () => ({
  getMonoClient: (id: string) => getMonoClient(id),
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
  state.insertFailures = 0;
  state.throwOnLoad = false;
  state.convOrg = "o-1";
  state.msgConv = CONV;
  state.ownerId = "u-1";
  state.mode = "per_user";
  state.monoId = null;
  state.inserted = [];
  loadOwnedMono.mockReset();
  getMonoClient.mockClear();
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
    // Was `toContain("Failed — Change a: Item not found.")`: the outcome turn
    // now opens with the record line the model is told to trust (A2).
    expect(state.inserted[0]!.content).toBe(
      [
        "You confirmed these changes.",
        "Failed: Change a (Item not found.)",
        "Applied: Change b",
      ].join("\n"),
    );
    expect(res.ok).toBe(true);
  });

  it("records applied and unticked rows in words the model reads as final", async () => {
    await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(state.inserted[0]!.content).toBe(
      [
        "You confirmed these changes.",
        "Applied: Change a",
        "Not applied (you left it unticked): Change b",
      ].join("\n"),
    );
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

describe("applyBatch · refused creates", () => {
  it("refuses a stored goal create at Apply without invoking", async () => {
    state.trace = {
      stagedCalls: [
        call("g", {
          tool: "manage_goal",
          input: { action: "create", orgId: "o-1" },
          boardId: null,
        }),
      ],
    };
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["g"],
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.trace).toMatchObject({
        stagedResults: [
          {
            id: "g",
            ok: false,
            error:
              "Creating goals from the assistant isn't available yet. Create it from the Goals page.",
          },
        ],
      });
    }
  });

  it("refuses when no selected id matches a stored call, before running or recording", async () => {
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["nope"],
    });
    expect(res).toMatchObject({
      ok: false,
      error: "Pick at least one change to apply.",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
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

  // Was "fails when the outcome insert fails": the rows have already run by
  // then, so a failure result made the card reopen and a second Apply
  // duplicate the creates. See F7.
  it("retries a failed outcome insert once", async () => {
    state.insertFailures = 1;
    const res = await applyBatch(args);
    expect(state.inserted).toHaveLength(2);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, data: { messageId: "out-1" } });
  });

  it("still reports success when the outcome cannot be recorded, because the rows ran", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.insertError = true;
    const res = await applyBatch(args);
    expect(state.inserted).toHaveLength(2);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.messageId).toMatch(/^local-/);
      // Was `toContain("Done — Change a")` (A2 outcome wording).
      expect(res.data.content).toContain("Applied: Change a");
      expect(res.data.trace).toMatchObject({
        resolvesProposal: MSG,
        outcome: "applied",
      });
      expect(res.data.touchedBoardIds).toEqual([BOARD]);
    }
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("could not be recorded"),
      expect.objectContaining({ message: "nope" }),
    );
    spy.mockRestore();
  });

  it("logs an unexpected failure instead of swallowing it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.throwOnLoad = true;
    const res = await applyBatch(args);
    expect(res.ok).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      "[assistant] applyBatch failed",
      expect.any(Error),
    );
    spy.mockRestore();
  });
});

describe("applyBatch · pinned to the active org", () => {
  const args = { conversationId: CONV, messageId: MSG, selectedIds: ["g"] };

  it("refuses a row that targets another org, without invoking", async () => {
    state.trace = {
      stagedCalls: [
        call("g", {
          tool: "manage_goal",
          input: { action: "update", orgId: "o-2" },
          boardId: null,
        }),
      ],
    };
    const res = await applyBatch(args);
    expect(res.ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(state.inserted[0]!.tool_trace.stagedResults).toEqual([
      {
        id: "g",
        ok: false,
        error: "This change targets a different organization.",
      },
    ]);
  });

  it("refuses an org-scoped row that carries no org", async () => {
    state.trace = {
      stagedCalls: [
        call("g", {
          tool: "manage_goal",
          input: { action: "update" },
          boardId: null,
        }),
      ],
    };
    await applyBatch(args);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("runs a row for the active org", async () => {
    state.trace = {
      stagedCalls: [
        call("g", {
          tool: "manage_goal",
          input: { action: "update", orgId: "o-1" },
          boardId: null,
        }),
      ],
    };
    await applyBatch(args);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![1]).toMatchObject({ orgId: "o-1" });
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

  it("fails when the outcome cannot be recorded: nothing ran", async () => {
    state.insertError = true;
    const res = await dismissBatch(args);
    expect(res.ok).toBe(false);
  });

  it("logs an unexpected failure instead of swallowing it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.throwOnLoad = true;
    const res = await dismissBatch(args);
    expect(res.ok).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      "[assistant] dismissBatch failed",
      expect.any(Error),
    );
    spy.mockRestore();
  });

  it("records a cancelled outcome and runs nothing", async () => {
    const res = await dismissBatch({ conversationId: CONV, messageId: MSG });
    expect(res.ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(state.inserted[0]!.tool_trace).toMatchObject({
      resolvesProposal: MSG,
      outcome: "cancelled",
    });
    expect(state.inserted[0]!.content).toBe(
      "You dismissed these changes. Nothing was changed.",
    );
  });
});

describe("applyBatch on a Mono thread", () => {
  it("applies every row as the Mono", async () => {
    state.monoId = "m-1";
    loadOwnedMono.mockResolvedValue({ userId: "m-1" });
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(res.ok).toBe(true);
    expect(loadOwnedMono).toHaveBeenCalledWith(supabase, "u-1", "o-1", "m-1");
    expect(getMonoClient).toHaveBeenCalledWith("m-1");
    const ctx = invoke.mock.calls[0]![0] as {
      actorId: string;
      getClient: () => Promise<unknown>;
    };
    expect(ctx.actorId).toBe("m-1");
    expect(await ctx.getClient()).toBe(monoClient);
  });

  it("refuses when the Mono is no longer the caller's", async () => {
    state.monoId = "m-1";
    loadOwnedMono.mockResolvedValue(null);
    const res = await applyBatch({
      conversationId: CONV,
      messageId: MSG,
      selectedIds: ["a"],
    });
    expect(res).toEqual({ ok: false, error: "Conversation not found." });
    expect(invoke).not.toHaveBeenCalled();
  });
});
