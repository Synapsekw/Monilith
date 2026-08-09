import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportAccess } from "@/lib/reports/access";
import type { ReportRow, ReportScope } from "@/lib/reports/queries";
import { defaultReportConfig } from "@/lib/reports/config";

// Valid RFC-4122 v4 UUIDs — Zod 4 enforces the version/variant nibbles.
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "1111aaaa-1111-4111-8111-111111111111";
const BOARD_A = "22222222-2222-4222-8222-222222222222";
const BOARD_B = "33333333-3333-4333-8333-333333333333";
const REPORT = "44444444-4444-4444-8444-444444444444";
const NEW_REPORT = "55555555-5555-4555-8555-555555555555";
const PORTFOLIO = "66666666-6666-4666-8666-666666666666";
const TEMPLATE = "77777777-7777-4777-8777-777777777777";
const USER = "88888888-8888-4888-8888-888888888888";

// ───────────────────────────────────────────────── fake Supabase query builder

type QueryResult = { data: unknown; error: { message: string } | null };

type Op = {
  table: string;
  kind: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: Record<string, unknown>;
};

interface FakeBuilder extends PromiseLike<QueryResult> {
  select(columns?: string): FakeBuilder;
  insert(payload: unknown): FakeBuilder;
  update(payload: unknown): FakeBuilder;
  delete(): FakeBuilder;
  eq(column: string, value: unknown): FakeBuilder;
  in(column: string, value: unknown): FakeBuilder;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

/** Every statement the action issued, in order. */
let ops: Op[] = [];
/** `table:kind` → what that statement resolves to. */
let results = new Map<string, QueryResult>();

function from(table: string): FakeBuilder {
  const op: Op = { table, kind: "select", filters: {} };
  ops.push(op);
  const run = (): Promise<QueryResult> =>
    Promise.resolve(
      results.get(`${op.table}:${op.kind}`) ?? { data: null, error: null },
    );
  const builder: FakeBuilder = {
    select: () => builder,
    insert: (payload) => {
      op.kind = "insert";
      op.payload = payload;
      return builder;
    },
    update: (payload) => {
      op.kind = "update";
      op.payload = payload;
      return builder;
    },
    delete: () => {
      op.kind = "delete";
      return builder;
    },
    eq: (column, value) => {
      op.filters[column] = value;
      return builder;
    },
    in: (column, value) => {
      op.filters[column] = value;
      return builder;
    },
    single: run,
    maybeSingle: run,
    then<A = QueryResult, B = never>(
      onOk?: ((v: QueryResult) => A | PromiseLike<A>) | null,
      onErr?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return run().then(onOk, onErr);
    },
  };
  return builder;
}

const opsFor = (table: string, kind: Op["kind"]): Op[] =>
  ops.filter((o) => o.table === table && o.kind === kind);

// ───────────────────────────────────────────────────────────────────── mocks

const getReport = vi.fn<(id: string) => Promise<ReportRow | null>>();
const resolveReportAccess = vi.fn<() => Promise<ReportAccess>>();
const getPortfolio =
  vi.fn<(id: string) => Promise<{ org_id: string; name: string } | null>>();
const revalidatePath = vi.fn<(path: string) => void>();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: USER }),
  getUser: async () => ({ id: USER }),
}));
vi.mock("@/lib/org/active", () => ({
  getActiveOrgId: async () => ORG,
  resolveActiveOrg: async () => ({ id: ORG, name: "Acme Inc" }),
}));
vi.mock("@/lib/reports/queries", () => ({
  REPORT_BOARDS_LIMIT: 50,
  getReport: (id: string) => getReport(id),
  resolveReportBoardIds: async () => [],
}));
// Keep the REAL `canEditReports` / `deriveReportAccess` — only the DB-backed
// resolver is doubled, so the guards under test run the shipping predicate.
vi.mock("@/lib/reports/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reports/access")>()),
  resolveReportAccess: () => resolveReportAccess(),
}));
vi.mock("@/lib/portfolios/queries", () => ({
  getPortfolio: (id: string) => getPortfolio(id),
}));
vi.mock("@/lib/reports/payload", () => ({
  loadReportScopeContext: async () => ({
    payloads: [],
    peopleNames: new Map<string, string>(),
    scopeLabel: "Roadmap",
    omittedBoardCount: 0,
    orgName: "Acme Inc",
  }),
}));
vi.mock("@/lib/reports/export-html", () => ({
  buildReportHtml: async () => "<!doctype html><html></html>",
}));
vi.mock("@/lib/reports/pdf", () => ({
  renderHtmlToPdf: async () => Buffer.from("pdf"),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));

import {
  createReport,
  createReportFromTemplate,
  deleteReport,
  exportReportPdf,
  saveReport,
  saveReportAsTemplate,
  setReportScope,
} from "@/lib/reports/actions";

// ────────────────────────────────────────────────────────────────── fixtures

function report(
  o: Partial<ReportRow> & { scope?: ReportScope } = {},
): ReportRow {
  return {
    id: REPORT,
    orgId: ORG,
    scope: "board",
    boardId: BOARD_A,
    portfolioId: null,
    name: "Q3",
    config: defaultReportConfig(),
    updatedAt: "2026-08-09T00:00:00Z",
    ...o,
  };
}

function access(o: Partial<ReportAccess> = {}): ReportAccess {
  return {
    boardIds: [BOARD_A],
    readableBoardIds: [BOARD_A],
    omittedCount: 0,
    canRead: true,
    canEdit: true,
    ...o,
  };
}

/** Boards `USER` created — i.e. owns, i.e. may edit reports on. */
function ownedBoards(...ids: string[]) {
  results.set("boards:select", {
    data: ids.map((id) => ({ id, created_by: USER, org_id: ORG })),
    error: null,
  });
}

beforeEach(() => {
  ops = [];
  results = new Map();
  getReport.mockReset();
  resolveReportAccess.mockReset();
  getPortfolio.mockReset();
  revalidatePath.mockReset();

  ownedBoards(BOARD_A, BOARD_B);
  results.set("board_members:select", { data: [], error: null });
  results.set("reports:insert", { data: { id: NEW_REPORT }, error: null });
  getReport.mockResolvedValue(report());
  resolveReportAccess.mockResolvedValue(access());
  getPortfolio.mockResolvedValue({ org_id: ORG, name: "FY26" });
});

// ─────────────────────────────────────────────────────────────── createReport

describe("createReport", () => {
  it("binds a 'board'-scoped report to exactly one board", async () => {
    const res = await createReport({
      name: "Q3",
      scope: "board",
      boardId: BOARD_A,
    });
    expect(res).toEqual({ ok: true, data: { id: NEW_REPORT } });

    const row = opsFor("reports", "insert")[0].payload as Record<
      string,
      unknown
    >;
    expect(row.scope).toBe("board");
    expect(row.board_id).toBe(BOARD_A);
    expect(row.portfolio_id).toBeNull();
    expect(row.org_id).toBe(ORG);
    expect(row.created_by).toBe(USER);

    expect(opsFor("report_boards", "insert")[0].payload).toEqual([
      { org_id: ORG, report_id: NEW_REPORT, board_id: BOARD_A, position: 0 },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/reports");
    expect(revalidatePath).toHaveBeenCalledWith(`/boards/${BOARD_A}/reports`);
  });

  it("binds a 'boards' roll-up to every board, in order, with no home board", async () => {
    const res = await createReport({
      name: "Exec",
      scope: "boards",
      boardIds: [BOARD_A, BOARD_B],
    });
    expect(res.ok).toBe(true);

    const row = opsFor("reports", "insert")[0].payload as Record<
      string,
      unknown
    >;
    expect(row.scope).toBe("boards");
    expect(row.board_id).toBeNull();
    expect(row.portfolio_id).toBeNull();

    expect(opsFor("report_boards", "insert")[0].payload).toEqual([
      { org_id: ORG, report_id: NEW_REPORT, board_id: BOARD_A, position: 0 },
      { org_id: ORG, report_id: NEW_REPORT, board_id: BOARD_B, position: 1 },
    ]);
  });

  it("writes NO membership rows for a portfolio report — it follows portfolio_boards", async () => {
    const res = await createReport({
      name: "Portfolio",
      scope: "portfolio",
      portfolioId: PORTFOLIO,
    });
    expect(res.ok).toBe(true);

    const row = opsFor("reports", "insert")[0].payload as Record<
      string,
      unknown
    >;
    expect(row.scope).toBe("portfolio");
    expect(row.board_id).toBeNull();
    expect(row.portfolio_id).toBe(PORTFOLIO);
    expect(opsFor("report_boards", "insert")).toHaveLength(0);
  });

  it("rejects a portfolio in another org", async () => {
    getPortfolio.mockResolvedValue({ org_id: OTHER_ORG, name: "Theirs" });
    const res = await createReport({
      name: "Portfolio",
      scope: "portfolio",
      portfolioId: PORTFOLIO,
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });

  it("writes NO membership rows and NO bindings for a template", async () => {
    const res = await createReport({ name: "Blank", scope: "template" });
    expect(res.ok).toBe(true);

    const row = opsFor("reports", "insert")[0].payload as Record<
      string,
      unknown
    >;
    expect(row.scope).toBe("template");
    expect(row.board_id).toBeNull();
    expect(row.portfolio_id).toBeNull();
    expect(opsFor("report_boards", "insert")).toHaveLength(0);
  });

  it("rejects binding a board the caller may only VIEW", async () => {
    results.set("boards:select", {
      data: [{ id: BOARD_A, created_by: "someone-else", org_id: ORG }],
      error: null,
    });
    results.set("board_members:select", {
      data: [{ board_id: BOARD_A, user_id: USER, access_level: "viewer" }],
      error: null,
    });
    const res = await createReport({
      name: "Nope",
      scope: "board",
      boardId: BOARD_A,
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });

  it("rejects a roll-up where ONE of the boards is not editable", async () => {
    results.set("boards:select", {
      data: [
        { id: BOARD_A, created_by: USER, org_id: ORG },
        { id: BOARD_B, created_by: "someone-else", org_id: ORG },
      ],
      error: null,
    });
    const res = await createReport({
      name: "Exec",
      scope: "boards",
      boardIds: [BOARD_A, BOARD_B],
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });

  it("rejects a board in ANOTHER org even when the caller owns it", async () => {
    results.set("boards:select", {
      data: [{ id: BOARD_A, created_by: USER, org_id: OTHER_ORG }],
      error: null,
    });
    const res = await createReport({
      name: "Cross-tenant",
      scope: "board",
      boardId: BOARD_A,
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });

  it("rejects more boards than REPORT_BOARDS_LIMIT before touching the DB", async () => {
    const boardIds = Array.from(
      { length: 51 },
      (_, i) => `${String(i).padStart(8, "0")}-2222-4222-8222-222222222222`,
    );
    const res = await createReport({
      name: "Too wide",
      scope: "boards",
      boardIds,
    });
    expect(res.ok).toBe(false);
    expect(ops).toHaveLength(0);
  });

  it("rejects an impossible scope/binding combination", async () => {
    const res = await createReport({ name: "Bad", scope: "board" });
    expect(res.ok).toBe(false);
    expect(ops).toHaveLength(0);
  });

  it("undoes the report row when its membership rows fail to write", async () => {
    results.set("report_boards:insert", {
      data: null,
      error: { message: "boom" },
    });
    const res = await createReport({
      name: "Q3",
      scope: "board",
      boardId: BOARD_A,
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "delete")[0].filters).toEqual({ id: NEW_REPORT });
  });
});

// ───────────────────────────────────────────────────────────────── saveReport

describe("saveReport", () => {
  it("rejects a caller who cannot edit the report", async () => {
    resolveReportAccess.mockResolvedValue(access({ canEdit: false }));
    const res = await saveReport({
      reportId: REPORT,
      name: "Q3",
      config: defaultReportConfig(),
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "update")).toHaveLength(0);
  });

  it("rejects a report that does not exist", async () => {
    getReport.mockResolvedValue(null);
    const res = await saveReport({
      reportId: REPORT,
      name: "Q3",
      config: defaultReportConfig(),
    });
    expect(res.ok).toBe(false);
  });

  it("sets updated_at by hand — there is no DB trigger", async () => {
    const res = await saveReport({
      reportId: REPORT,
      name: "Q3 final",
      config: defaultReportConfig(),
    });
    expect(res.ok).toBe(true);
    const patch = opsFor("reports", "update")[0].payload as Record<
      string,
      unknown
    >;
    expect(patch.name).toBe("Q3 final");
    expect(typeof patch.updated_at).toBe("string");
    expect(opsFor("reports", "update")[0].filters).toEqual({ id: REPORT });
  });

  it("scopes the write by the report id ALONE — no client board id exists", async () => {
    await saveReport({
      reportId: REPORT,
      name: "Q3",
      config: defaultReportConfig(),
    });
    expect(opsFor("reports", "update")[0].filters).toEqual({ id: REPORT });
  });
});

// ─────────────────────────────────────────────────────────────── deleteReport

describe("deleteReport", () => {
  it("rejects a caller who cannot edit the report", async () => {
    resolveReportAccess.mockResolvedValue(access({ canEdit: false }));
    const res = await deleteReport({ reportId: REPORT });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "delete")).toHaveLength(0);
  });

  it("deletes by report id and revalidates the lists it was on", async () => {
    const res = await deleteReport({ reportId: REPORT });
    expect(res.ok).toBe(true);
    expect(opsFor("reports", "delete")[0].filters).toEqual({ id: REPORT });
    expect(revalidatePath).toHaveBeenCalledWith("/reports");
    expect(revalidatePath).toHaveBeenCalledWith(`/boards/${BOARD_A}/reports`);
  });
});

// ────────────────────────────────────────────────────────────── setReportScope

describe("setReportScope", () => {
  it("rejects a caller who cannot edit the report", async () => {
    resolveReportAccess.mockResolvedValue(access({ canEdit: false }));
    const res = await setReportScope({
      reportId: REPORT,
      scope: "boards",
      boardIds: [BOARD_A, BOARD_B],
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "update")).toHaveLength(0);
  });

  it("rejects widening onto a board the caller cannot edit", async () => {
    results.set("boards:select", {
      data: [
        { id: BOARD_A, created_by: USER, org_id: ORG },
        { id: BOARD_B, created_by: "someone-else", org_id: ORG },
      ],
      error: null,
    });
    const res = await setReportScope({
      reportId: REPORT,
      scope: "boards",
      boardIds: [BOARD_A, BOARD_B],
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "update")).toHaveLength(0);
  });

  it("clears the stale membership rows and writes the new set", async () => {
    const res = await setReportScope({
      reportId: REPORT,
      scope: "boards",
      boardIds: [BOARD_A, BOARD_B],
    });
    expect(res.ok).toBe(true);

    const patch = opsFor("reports", "update")[0].payload as Record<
      string,
      unknown
    >;
    expect(patch.scope).toBe("boards");
    expect(patch.board_id).toBeNull();
    expect(patch.portfolio_id).toBeNull();
    expect(typeof patch.updated_at).toBe("string");

    expect(opsFor("report_boards", "delete")[0].filters).toEqual({
      report_id: REPORT,
    });
    expect(opsFor("report_boards", "insert")[0].payload).toEqual([
      { org_id: ORG, report_id: REPORT, board_id: BOARD_A, position: 0 },
      { org_id: ORG, report_id: REPORT, board_id: BOARD_B, position: 1 },
    ]);
  });

  it("clears membership entirely when re-scoping onto a portfolio", async () => {
    const res = await setReportScope({
      reportId: REPORT,
      scope: "portfolio",
      portfolioId: PORTFOLIO,
    });
    expect(res.ok).toBe(true);
    expect(opsFor("report_boards", "delete")).toHaveLength(1);
    expect(opsFor("report_boards", "insert")).toHaveLength(0);
  });

  it("revalidates the boards it LEFT as well as the ones it joined", async () => {
    resolveReportAccess.mockResolvedValue(access({ boardIds: [BOARD_A] }));
    await setReportScope({
      reportId: REPORT,
      scope: "board",
      boardId: BOARD_B,
    });
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain(`/boards/${BOARD_A}/reports`);
    expect(paths).toContain(`/boards/${BOARD_B}/reports`);
  });
});

// ────────────────────────────────────────────────────────────── exportReportPdf

describe("exportReportPdf", () => {
  it("lets a VIEWER export — read access is the bar, not edit", async () => {
    resolveReportAccess.mockResolvedValue(
      access({ canEdit: false, canRead: true }),
    );
    const res = await exportReportPdf({ reportId: REPORT });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.fileName).toBe("Q3.pdf");
      expect(res.data.mime).toBe("application/pdf");
    }
  });

  it("refuses a caller with no read access to the report", async () => {
    resolveReportAccess.mockResolvedValue(
      access({ canRead: false, canEdit: false }),
    );
    const res = await exportReportPdf({ reportId: REPORT });
    expect(res.ok).toBe(false);
  });

  it("sanitizes the report name into the file name", async () => {
    getReport.mockResolvedValue(report({ name: "Q3 / Ops <update>" }));
    const res = await exportReportPdf({ reportId: REPORT });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.fileName).toBe("Q3_Ops_update_.pdf");
  });
});

// ─────────────────────────────────────────────────────── saveReportAsTemplate

describe("saveReportAsTemplate", () => {
  it("inserts a NEW template row with no bindings, copying the config", async () => {
    const source = report({ config: { ...defaultReportConfig(), title: "T" } });
    getReport.mockResolvedValue(source);

    const res = await saveReportAsTemplate({
      reportId: REPORT,
      name: "Standard status",
    });
    expect(res).toEqual({ ok: true, data: { id: NEW_REPORT } });

    const row = opsFor("reports", "insert")[0].payload as Record<
      string,
      unknown
    >;
    expect(row.scope).toBe("template");
    expect(row.board_id).toBeNull();
    expect(row.portfolio_id).toBeNull();
    expect(row.org_id).toBe(ORG);
    expect(row.name).toBe("Standard status");
    expect(row.config).toEqual(source.config);
    // A template lives in the org gallery, never on a board.
    expect(opsFor("report_boards", "insert")).toHaveLength(0);
  });

  it("rejects a caller who cannot edit the source report", async () => {
    resolveReportAccess.mockResolvedValue(access({ canEdit: false }));
    const res = await saveReportAsTemplate({ reportId: REPORT, name: "T" });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────── createReportFromTemplate

describe("createReportFromTemplate", () => {
  const template = report({
    id: TEMPLATE,
    scope: "template",
    boardId: null,
    config: { ...defaultReportConfig(), title: "Template title" },
  });

  it("copies the template config into a new report with the given bindings", async () => {
    getReport.mockResolvedValue(template);
    const res = await createReportFromTemplate({
      templateId: TEMPLATE,
      name: "Q4",
      scope: "boards",
      boardIds: [BOARD_A, BOARD_B],
    });
    expect(res).toEqual({ ok: true, data: { id: NEW_REPORT } });

    const row = opsFor("reports", "insert")[0].payload as Record<
      string,
      unknown
    >;
    expect(row.scope).toBe("boards");
    expect(row.name).toBe("Q4");
    expect(row.config).toEqual(template.config);
    expect(opsFor("report_boards", "insert")[0].payload).toEqual([
      { org_id: ORG, report_id: NEW_REPORT, board_id: BOARD_A, position: 0 },
      { org_id: ORG, report_id: NEW_REPORT, board_id: BOARD_B, position: 1 },
    ]);
  });

  it("refuses a source that is not a template", async () => {
    getReport.mockResolvedValue(report({ id: TEMPLATE, scope: "board" }));
    const res = await createReportFromTemplate({
      templateId: TEMPLATE,
      name: "Q4",
      scope: "board",
      boardId: BOARD_A,
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });

  it("refuses a template belonging to another org", async () => {
    getReport.mockResolvedValue(report({ ...template, orgId: OTHER_ORG }));
    const res = await createReportFromTemplate({
      templateId: TEMPLATE,
      name: "Q4",
      scope: "board",
      boardId: BOARD_A,
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });

  it("refuses to bind boards the caller cannot edit", async () => {
    getReport.mockResolvedValue(template);
    results.set("boards:select", {
      data: [{ id: BOARD_A, created_by: "someone-else", org_id: ORG }],
      error: null,
    });
    const res = await createReportFromTemplate({
      templateId: TEMPLATE,
      name: "Q4",
      scope: "board",
      boardId: BOARD_A,
    });
    expect(res.ok).toBe(false);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });
});
