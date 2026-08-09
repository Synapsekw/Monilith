import { describe, expect, it, vi } from "vitest";

// Valid RFC-4122 UUIDs (version nibble 4, variant nibble 8) — Zod v4's
// `.uuid()` rejects the plain 1111…/2222… form as an invalid variant.
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";

const buildReportHtml = vi.fn(
  async (_arg: { orgName: string }) => "<!doctype html><html></html>",
);
const resolveActiveOrg = vi.fn<
  () => Promise<{ id: string; name: string } | null>
>(async () => ({ id: ORG_ID, name: "Acme Inc" }));

vi.mock("@/lib/org/active", () => ({
  getActiveOrgId: async () => ORG_ID,
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/reports/access", () => ({
  canEditReports: () => true,
  resolveReportAccess: async () => ({
    boardIds: [BOARD_ID],
    readableBoardIds: [BOARD_ID],
    omittedCount: 0,
    canRead: true,
    canEdit: true,
  }),
}));
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: async () => ({
    board: { id: BOARD_ID, name: "Roadmap", org_id: ORG_ID },
    columns: [],
    groups: [],
    items: [],
    cellValues: [],
  }),
  deriveBoardAccess: () => "owner",
}));
vi.mock("@/lib/reports/queries", () => ({
  REPORT_BOARDS_LIMIT: 50,
  getReport: async () => ({
    id: REPORT_ID,
    orgId: ORG_ID,
    scope: "board",
    boardId: BOARD_ID,
    portfolioId: null,
    name: "Q3",
    config: { v: 1, title: "Q3", blocks: [] },
    updatedAt: "2026-08-09T00:00:00Z",
  }),
}));
vi.mock("@/lib/portfolios/queries", () => ({ getPortfolio: async () => null }));
vi.mock("@/lib/boards/people-names", () => ({
  resolvePeopleNames: async () => new Map<string, string>(),
}));
vi.mock("@/lib/reports/export-html", () => ({ buildReportHtml }));
vi.mock("@/lib/reports/pdf", () => ({
  renderHtmlToPdf: async () => Buffer.from("pdf"),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("exportReportPdf cover org name", () => {
  it("passes the org display name to buildReportHtml, not the org UUID", async () => {
    const { exportReportPdf } = await import("@/lib/reports/actions");
    const res = await exportReportPdf({ reportId: REPORT_ID });
    expect(res.ok).toBe(true);
    expect(buildReportHtml).toHaveBeenCalledOnce();
    const arg = buildReportHtml.mock.calls[0][0] as { orgName: string };
    expect(arg.orgName).toBe("Acme Inc");
    expect(arg.orgName).not.toBe(ORG_ID);
  });

  it("falls back to an EMPTY org name, never the board name", async () => {
    buildReportHtml.mockClear();
    resolveActiveOrg.mockResolvedValueOnce(null);
    const { exportReportPdf } = await import("@/lib/reports/actions");
    const res = await exportReportPdf({ reportId: REPORT_ID });
    expect(res.ok).toBe(true);
    const arg = buildReportHtml.mock.calls[0][0] as { orgName: string };
    expect(arg.orgName).toBe("");
    expect(arg.orgName).not.toBe("Roadmap");
  });
});
