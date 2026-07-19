import { describe, expect, it, vi, beforeEach } from "vitest";

const reportBoardAccess = vi.fn(async () => "viewer" as string | null);
const requireAiEntitlement = vi.fn(async () => {});
const runAi = vi.fn(async () => ({}) as never);

// Keep the REAL canEditReports (owner/editor only); override only the async
// access lookup so no DB is touched.
vi.mock("@/lib/reports/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reports/access")>()),
  reportBoardAccess: (...a: unknown[]) => reportBoardAccess(...(a as [])),
}));
vi.mock("@/lib/ai/entitlement", () => ({ requireAiEntitlement }));
vi.mock("@/lib/ai/gateway", () => ({ runAi }));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => ({ id: "org-1", name: "Acme Inc" }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/boards/queries", () => ({ getBoardPayload: async () => null }));

describe("draftReportNarrativeAction edit-gate", () => {
  beforeEach(() => {
    reportBoardAccess.mockReset().mockResolvedValue("viewer");
    requireAiEntitlement.mockReset();
    runAi.mockReset();
  });

  it("rejects a viewer and spends no AI credits", async () => {
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    const res = await draftReportNarrativeAction({
      boardId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.ok).toBe(false);
    // The whole point: no entitlement check and no gateway call on the viewer path.
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("passes the edit-gate for an editor (reaches the entitlement step)", async () => {
    reportBoardAccess.mockResolvedValue("editor");
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    await draftReportNarrativeAction({
      boardId: "00000000-0000-0000-0000-000000000000",
    });
    // getBoardPayload returns null after entitlement, so the action fails later —
    // but it got PAST the edit-gate, proving the gate is edit-level not any-access.
    expect(requireAiEntitlement).toHaveBeenCalledOnce();
  });
});
