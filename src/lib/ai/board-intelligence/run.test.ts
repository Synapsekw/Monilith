import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { runBoardIntelligence } from "./run";

const BOARD = "11111111-1111-4111-8111-111111111111";
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
const freshRun = {
  id: "r1",
  boardId: BOARD,
  generatedAt: new Date().toISOString(),
  inputHash: "",
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

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1" });
  resolveActiveOrg.mockResolvedValue({ id: "o1", timezone: "UTC" });
  getBoardPayload.mockResolvedValue(payload);
  listOrgMembersCached.mockResolvedValue([
    { userId: "u1", fullName: "Me", email: "x", avatarUrl: null },
  ]);
  getBoardLastSeenAt.mockResolvedValue(null);
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
    // input hash of an empty board with no signals — compute it the same way run.ts does
    const { intelligenceInputHash } = await import("./input-hash");
    getLatestBoardIntelligenceRun.mockResolvedValue({
      ...freshRun,
      inputHash: intelligenceInputHash({
        itemCount: 0,
        maxUpdatedAt: null,
        signals: [],
      }),
    });
    const res = await runBoardIntelligence({ boardId: BOARD });
    expect(res).toMatchObject({ ok: true, data: { id: "r1" } });
    expect(runAi).not.toHaveBeenCalled();
  });
  it("runs the model when forced, records under board_intelligence, and stores the row", async () => {
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
  });
});
