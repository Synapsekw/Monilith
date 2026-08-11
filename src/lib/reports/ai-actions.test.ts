import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";

type Access = {
  boardIds: string[];
  readableBoardIds: string[];
  omittedCount: number;
  canRead: boolean;
  canEdit: boolean;
};

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";
const B3 = "33333333-3333-3333-3333-333333333333";
const REPORT_ID = "00000000-0000-0000-0000-000000000000";

const report = {
  id: REPORT_ID,
  orgId: "org-1",
  scope: "boards" as string,
  boardId: null as string | null,
  portfolioId: null as string | null,
  name: "Weekly",
  config: {},
  updatedAt: "2026-01-01T00:00:00Z",
};

const getReport = vi.fn(async () => report as unknown);
const resolveReportAccess = vi.fn(
  async () =>
    ({
      boardIds: [B1],
      readableBoardIds: [B1],
      omittedCount: 0,
      canRead: true,
      canEdit: false,
    }) as Access,
);
const requireAiEntitlement = vi.fn(async () => {});
const getBoardPayload = vi.fn(async (_boardId: string) => null as unknown);

/** Records what actually reached the provider, so "the model never saw board X"
 *  can be asserted on the prompt itself rather than on a fetch count alone. */
const generateStructured = vi.fn(
  async (_req: { system: string; user: string }) => ({
    data: { summary: "s", highlights: [], risks: [] },
    usage: { inputTokens: 1, outputTokens: 1 },
    model: "test-model",
  }),
);

const runAi = vi.fn(
  async (
    _args: unknown,
    fn: (r: unknown) => Promise<{ result: unknown }>,
  ): Promise<unknown> => {
    const { result } = await fn({
      adapter: { generateStructured },
      apiKey: "k",
      baseUrl: null,
      mode: "managed",
      provider: "anthropic",
      model: fakeResolvedModel(),
    });
    return result;
  },
);

vi.mock("@/lib/reports/queries", () => ({
  getReport: (...a: unknown[]) => getReport(...(a as [])),
}));
vi.mock("@/lib/reports/access", () => ({
  resolveReportAccess: (...a: unknown[]) => resolveReportAccess(...(a as [])),
}));
vi.mock("@/lib/ai/entitlement", () => ({ requireAiEntitlement }));
vi.mock("@/lib/ai/gateway", () => ({ runAi }));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => ({ id: "org-1", name: "Acme Inc" }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (...a: unknown[]) => getBoardPayload(...(a as [string])),
}));

function payloadFor(boardId: string, name: string) {
  return {
    board: { id: boardId, name },
    groups: [],
    columns: [
      {
        id: `col-${boardId}`,
        name: `Status of ${name}`,
        kind: "status",
        settings: null,
      },
    ],
    items: [],
    cellValues: [],
  };
}

function access(over: Partial<Access>): Access {
  return {
    boardIds: [B1],
    readableBoardIds: [B1],
    omittedCount: 0,
    canRead: true,
    canEdit: true,
    ...over,
  };
}

describe("draftReportNarrativeAction edit-gate", () => {
  beforeEach(() => {
    getReport.mockReset().mockResolvedValue(report);
    resolveReportAccess
      .mockReset()
      .mockResolvedValue(access({ canEdit: false }));
    requireAiEntitlement.mockReset();
    runAi.mockClear();
    getBoardPayload.mockReset().mockResolvedValue(null);
    generateStructured.mockClear();
  });

  it("rejects a viewer and spends no AI credits", async () => {
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    const res = await draftReportNarrativeAction({ reportId: REPORT_ID });
    expect(res.ok).toBe(false);
    // The whole point: no entitlement check and no gateway call on the viewer path.
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it("passes the edit-gate for an editor with 3 readable boards (reaches the entitlement step)", async () => {
    resolveReportAccess.mockResolvedValue(
      access({ boardIds: [B1, B2, B3], readableBoardIds: [B1, B2, B3] }),
    );
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    await draftReportNarrativeAction({ reportId: REPORT_ID });
    // getBoardPayload returns null after entitlement, so the action fails later —
    // but it got PAST the edit-gate, proving the gate is edit-level not any-access.
    expect(requireAiEntitlement).toHaveBeenCalledOnce();
    expect(requireAiEntitlement).toHaveBeenCalledWith(
      "org-1",
      "report_narrative",
    );
  });

  it("fails a template-scope report without calling the model", async () => {
    getReport.mockResolvedValue({ ...report, scope: "template" });
    resolveReportAccess.mockResolvedValue(
      access({ boardIds: [], readableBoardIds: [] }),
    );
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    const res = await draftReportNarrativeAction({ reportId: REPORT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/template/i);
    expect(runAi).not.toHaveBeenCalled();
    expect(requireAiEntitlement).not.toHaveBeenCalled();
  });

  it("fails when the report is missing", async () => {
    getReport.mockResolvedValue(null);
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    const res = await draftReportNarrativeAction({ reportId: REPORT_ID });
    expect(res.ok).toBe(false);
    expect(runAi).not.toHaveBeenCalled();
  });

  it("only fetches readable boards — an unreadable board never reaches the model", async () => {
    resolveReportAccess.mockResolvedValue(
      access({
        boardIds: [B1, B2, B3],
        readableBoardIds: [B1, B3],
        omittedCount: 1,
      }),
    );
    getBoardPayload.mockImplementation(async (id: string) =>
      id === B1
        ? payloadFor(B1, "Roadmap")
        : id === B3
          ? payloadFor(B3, "Hiring")
          : payloadFor(id, "SECRET BOARD"),
    );
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    const res = await draftReportNarrativeAction({ reportId: REPORT_ID });
    expect(res.ok).toBe(true);

    const fetched = getBoardPayload.mock.calls.map((c) => c[0]);
    expect(fetched).toEqual([B1, B3]);
    expect(fetched).not.toContain(B2);

    const { user } = generateStructured.mock.calls[0][0];
    expect(user).toContain("Roadmap");
    expect(user).toContain("Hiring");
    expect(user).not.toContain("SECRET BOARD");
    expect(user).not.toContain(B2);
  });

  it("rejects a malformed reportId before any lookup", async () => {
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    const res = await draftReportNarrativeAction({ reportId: "nope" });
    expect(res.ok).toBe(false);
    expect(getReport).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });
});
