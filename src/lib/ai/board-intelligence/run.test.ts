import { beforeEach, describe, expect, it, vi } from "vitest";
import { intelligenceInputHash } from "./input-hash";

const requireUser = vi.fn();
const resolveActiveOrg = vi.fn();
const requireAiEntitlement = vi.fn();
const runAi = vi.fn();
const getBoardPayload = vi.fn();
const listOrgMembersCached = vi.fn();
const getBoardLastSeenAt = vi.fn();
const getLatestBoardIntelligenceRun = vi.fn();
const generateBoardIntelligence = vi.fn();
const from = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...a: unknown[]) => requireAiEntitlement(...a),
}));
vi.mock("@/lib/ai/gateway", () => ({
  runAi: (...a: unknown[]) => runAi(...a),
}));
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (id: string) => getBoardPayload(id),
}));
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: (id: string) => listOrgMembersCached(id),
}));
vi.mock("@/lib/boards/intelligence/visits", () => ({
  getBoardLastSeenAt: (...a: unknown[]) => getBoardLastSeenAt(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => from(t) }),
}));
vi.mock("./generate", () => ({
  generateBoardIntelligence: (...a: unknown[]) =>
    generateBoardIntelligence(...a),
}));
vi.mock("./runs", async (orig) => ({
  ...(await orig<typeof import("./runs")>()),
  getLatestBoardIntelligenceRun: (...a: unknown[]) =>
    getLatestBoardIntelligenceRun(...a),
}));

import { dismissSuggestion, runBoardIntelligence } from "./run";

const BOARD = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const payload = {
  board: { id: BOARD, org_id: "o1", name: "B" },
  groups: [],
  columns: [],
  items: [],
  cellValues: [],
  dependencies: [],
  views: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
};
// The hash `run.ts` actually computes for the empty board above (0 items, no
// activity, no signals) — used so cache-hit tests are isolated from a
// hash-mismatch and force-only tests are isolated from a stale-hash match.
const EMPTY_BOARD_HASH = intelligenceInputHash({
  itemCount: 0,
  maxUpdatedAt: null,
  signals: [],
});
const freshRun = {
  id: "r1",
  boardId: BOARD,
  generatedAt: new Date().toISOString(),
  inputHash: EMPTY_BOARD_HASH,
  payload: { brief: "cached", suggestions: [], signals: [] },
  dismissed: [],
  applied: [],
  model: "m",
  tokensIn: 0,
  tokensOut: 0,
};

// A chainable query stub: every builder method returns itself; awaiting resolves `result`.
const chain = (result: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "gte",
    "order",
    "limit",
    "insert",
    "single",
    "maybeSingle",
    "update",
    "in",
  ])
    q[m] = () => q;
  (q as { then: unknown }).then = (res: (v: unknown) => void) => res(result);
  return q;
};

/** Like `chain`, but records the arguments each builder method was called
 * with, so a test can assert on what was actually sent (e.g. the deduped
 * `dismissed` array passed to `.update()`). */
const spyChain = (result: unknown) => {
  const calls: Record<string, unknown[][]> = {};
  const q: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "gte",
    "order",
    "limit",
    "insert",
    "single",
    "maybeSingle",
    "update",
    "in",
  ]) {
    calls[m] = [];
    q[m] = (...args: unknown[]) => {
      calls[m].push(args);
      return q;
    };
  }
  (q as { then: unknown }).then = (res: (v: unknown) => void) => res(result);
  return { q, calls };
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1" });
  resolveActiveOrg.mockResolvedValue({ id: "o1", timezone: "UTC" });
  getBoardPayload.mockResolvedValue(payload);
  listOrgMembersCached.mockResolvedValue([
    { userId: "u1", fullName: "Me", email: "x", avatarUrl: null },
  ]);
  getBoardLastSeenAt.mockResolvedValue(null);
  getLatestBoardIntelligenceRun.mockResolvedValue(null);
  from.mockImplementation((t: string) =>
    t === "board_intelligence_runs"
      ? chain({
          data: {
            id: "r2",
            org_id: "o1",
            board_id: BOARD,
            user_id: "u1",
            generated_at: "2026-09-11T10:00:00.000Z",
            input_hash: "h",
            payload: { brief: "new", suggestions: [], signals: [] },
            dismissed: [],
            applied: [],
            model: "m",
            tokens_in: 1,
            tokens_out: 1,
          },
          error: null,
        })
      : chain({ data: [], error: null }),
  );
  runAi.mockImplementation(
    async (_args: unknown, fn: (r: unknown) => Promise<{ result: unknown }>) =>
      (
        await fn({
          adapter: {},
          apiKey: "k",
          baseUrl: null,
          model: { requestModel: "wire", model: "cat" },
        })
      ).result,
  );
  generateBoardIntelligence.mockResolvedValue({
    raw: { brief: "new", suggestions: [] },
    usage: { inputTokens: 1, outputTokens: 1 },
    model: "m",
  });
});

describe("runBoardIntelligence", () => {
  it("rejects a malformed board id before touching anything", async () => {
    expect(await runBoardIntelligence({ boardId: "nope" })).toEqual({
      ok: false,
      error: "Invalid board.",
    });
    expect(getBoardPayload).not.toHaveBeenCalled();
  });
  it("serves a fresh cached run with NO model call", async () => {
    getLatestBoardIntelligenceRun.mockResolvedValue(freshRun);
    const res = await runBoardIntelligence({ boardId: BOARD });
    expect(res).toMatchObject({ ok: true, data: { id: "r1" } });
    expect(runAi).not.toHaveBeenCalled();
  });
  it("runs the model when forced, records under board_intelligence, and stores the row", async () => {
    // Same fresh, correctly-hashed cached run as the no-model-call test above
    // — the ONLY difference is `force: true`, isolating force from staleness.
    getLatestBoardIntelligenceRun.mockResolvedValue(freshRun);
    const res = await runBoardIntelligence({ boardId: BOARD, force: true });
    expect(runAi).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "board_intelligence",
        orgId: "o1",
        userId: "u1",
      }),
      expect.any(Function),
    );
    expect(requireAiEntitlement).toHaveBeenCalledWith(
      "o1",
      "board_intelligence",
    );
    expect(res).toMatchObject({
      ok: true,
      data: { id: "r2", payload: { brief: "new" } },
    });
  });
  it("does NOT run the model when not forced and the hash still matches", async () => {
    getLatestBoardIntelligenceRun.mockResolvedValue(freshRun);
    const res = await runBoardIntelligence({ boardId: BOARD, force: false });
    expect(runAi).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, data: { id: "r1" } });
  });
  it("re-runs after a cell-only edit — a newer cell updated_at changes the hash even though the item's own updated_at is stale", async () => {
    const stalePayload = {
      ...payload,
      items: [
        {
          id: "i1",
          name: "Item",
          group_id: "g1",
          parent_id: null,
          updated_at: "2020-01-01T00:00:00.000Z",
        },
      ],
      cellValues: [
        {
          item_id: "i1",
          column_id: "c1",
          value: {},
          updated_at: "2026-09-11T09:00:00.000Z",
        },
      ],
    };
    getBoardPayload.mockResolvedValue(stalePayload);
    // A run cached from BEFORE the cell edit — hashed on the item's own
    // (older) updated_at only, the pre-fix behaviour.
    getLatestBoardIntelligenceRun.mockResolvedValue({
      ...freshRun,
      inputHash: intelligenceInputHash({
        itemCount: 1,
        maxUpdatedAt: "2020-01-01T00:00:00.000Z",
        signals: [],
      }),
    });
    const res = await runBoardIntelligence({ boardId: BOARD });
    expect(runAi).toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, data: { id: "r2" } });
  });
  it("maps a gateway failure to the fallback copy", async () => {
    getLatestBoardIntelligenceRun.mockResolvedValue(null);
    runAi.mockRejectedValue(new Error("boom"));
    expect(await runBoardIntelligence({ boardId: BOARD })).toEqual({
      ok: false,
      error: "Couldn't read this board. Please try again.",
    });
  });
  it("returns not found when the payload is RLS-hidden", async () => {
    getBoardPayload.mockResolvedValue(null);
    expect(await runBoardIntelligence({ boardId: BOARD })).toEqual({
      ok: false,
      error: "Board not found.",
    });
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });
  it("returns not found when the active org doesn't own the board", async () => {
    resolveActiveOrg.mockResolvedValue({ id: "o2", timezone: "UTC" });
    expect(await runBoardIntelligence({ boardId: BOARD })).toEqual({
      ok: false,
      error: "Board not found.",
    });
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });
  it("fails when a transcript read errors, instead of caching a brief built on an empty transcript", async () => {
    from.mockImplementation((t: string) => {
      if (t === "item_activities")
        return chain({ data: null, error: { message: "boom" } });
      return chain({ data: [], error: null });
    });
    const res = await runBoardIntelligence({ boardId: BOARD });
    expect(res).toEqual({
      ok: false,
      error: "Couldn't read recent activity.",
    });
    expect(runAi).not.toHaveBeenCalled();
  });
});

describe("dismissSuggestion", () => {
  const baseRow = {
    id: RUN_ID,
    org_id: "o1",
    board_id: BOARD,
    user_id: "u1",
    generated_at: "2026-09-11T10:00:00.000Z",
    input_hash: "h",
    payload: {
      brief: "b",
      suggestions: [
        {
          id: "s1",
          kind: "overdue" as const,
          title: "t",
          evidence: "e",
          body: "b",
          evidenceRows: [],
          actions: [
            {
              type: "filter" as const,
              signalKind: "overdue" as const,
              label: "l",
            },
          ],
        },
      ],
      signals: [],
    },
    dismissed: [] as string[],
    applied: [],
    model: "m",
    tokens_in: 1,
    tokens_out: 1,
  };

  it("dedupes an already-dismissed id and returns the updated run", async () => {
    const selectChain = spyChain({
      data: { ...baseRow, dismissed: ["s1"] },
      error: null,
    });
    const updateChain = spyChain({
      data: { ...baseRow, dismissed: ["s1"] },
      error: null,
    });
    from.mockReturnValueOnce(selectChain.q).mockReturnValueOnce(updateChain.q);
    const res = await dismissSuggestion({ runId: RUN_ID, suggestionId: "s1" });
    expect(res).toMatchObject({ ok: true, data: { dismissed: ["s1"] } });
    // The dedupe: dismissing an id already in `dismissed` sends a single
    // copy, not two, to the update.
    expect(updateChain.calls.update[0][0]).toEqual({ dismissed: ["s1"] });
  });

  it("fails on an unknown suggestion id without issuing an update", async () => {
    const selectChain = spyChain({ data: baseRow, error: null });
    from.mockReturnValueOnce(selectChain.q);
    const res = await dismissSuggestion({ runId: RUN_ID, suggestionId: "s9" });
    expect(res).toEqual({ ok: false, error: "Suggestion not found." });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("fails when the run is missing", async () => {
    const selectChain = spyChain({ data: null, error: null });
    from.mockReturnValueOnce(selectChain.q);
    const res = await dismissSuggestion({ runId: RUN_ID, suggestionId: "s1" });
    expect(res).toEqual({ ok: false, error: "Brief not found." });
  });
});
