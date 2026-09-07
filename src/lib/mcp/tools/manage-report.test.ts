import { beforeEach, describe, expect, it } from "vitest";
import { manageReportDescriptor } from "./manage-report";
import { defaultReportConfig } from "@/lib/reports/config";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "1111aaaa-1111-4111-8111-111111111111";
const BOARD_A = "22222222-2222-4222-8222-222222222222";
const BOARD_B = "33333333-3333-4333-8333-333333333333";
const REPORT = "44444444-4444-4444-8444-444444444444";
const NEW_REPORT = "55555555-5555-4555-8555-555555555555";
const PORTFOLIO = "66666666-6666-4666-8666-666666666666";
const USER = "88888888-8888-4888-8888-888888888888";

// ───────────────────────────────────────────────── fake Supabase query builder
// Same shape as `src/lib/reports/actions.test.ts`'s, plus the `order`/`limit`
// links `resolveReportBoardIdsCore` uses — this test drives the REAL access
// resolution, not a doubled one.

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
  order(column: string, opts?: unknown): FakeBuilder;
  limit(n: number): FakeBuilder;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

let ops: Op[] = [];
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
    order: () => builder,
    limit: () => builder,
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

let orgs: { id: string; name: string }[] = [];

/** `organizations` is listToolOrgs' read (select→order, awaited); everything
 *  else goes through the generic builder. */
const supabase = {
  from: (table: string) => {
    if (table === "organizations")
      return {
        select: () => ({ order: async () => ({ data: orgs, error: null }) }),
      };
    return from(table);
  },
} as never;

const ctx = { actorId: USER, getClient: async () => supabase };

beforeEach(() => {
  ops = [];
  results = new Map();
  orgs = [{ id: ORG, name: "Acme" }];
  // Boards USER created — i.e. owns, i.e. may edit reports on.
  results.set("boards:select", {
    data: [
      { id: BOARD_A, created_by: USER, org_id: ORG },
      { id: BOARD_B, created_by: USER, org_id: ORG },
    ],
    error: null,
  });
  results.set("board_members:select", { data: [], error: null });
  results.set("reports:insert", { data: { id: NEW_REPORT }, error: null });
});

describe("manage_report create", () => {
  it("binds a board-scoped report in the caller's only org", async () => {
    const r = await manageReportDescriptor.invoke(ctx, {
      action: "create",
      name: "Q3",
      scope: "board",
      boardId: BOARD_A,
    });

    expect(r.isError).toBeUndefined();
    const row = opsFor("reports", "insert")[0].payload as Record<
      string,
      unknown
    >;
    expect(row.org_id).toBe(ORG);
    expect(row.board_id).toBe(BOARD_A);
    expect(row.created_by).toBe(USER);
    expect(opsFor("report_boards", "insert")[0].payload).toEqual([
      { org_id: ORG, report_id: NEW_REPORT, board_id: BOARD_A, position: 0 },
    ]);
    expect(JSON.parse(r.content[0].text)).toEqual({
      reportId: NEW_REPORT,
      boardIds: [BOARD_A],
      orgId: ORG,
    });
  });

  // resolveToolOrg refuses an org the caller is not in — never substitutes.
  it("refuses an orgId the caller is not a member of", async () => {
    const r = await manageReportDescriptor.invoke(ctx, {
      action: "create",
      name: "Q3",
      scope: "board",
      boardId: BOARD_A,
      orgId: OTHER_ORG,
    });
    expect(r.isError).toBe(true);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });

  // `bindingDenialReason` survived the move: a board the caller cannot edit
  // reports on is not bindable, even though RLS would show it.
  it("refuses a roll-up over a board the caller cannot edit", async () => {
    results.set("boards:select", {
      data: [
        { id: BOARD_A, created_by: USER, org_id: ORG },
        { id: BOARD_B, created_by: "someone-else", org_id: ORG },
      ],
      error: null,
    });
    const r = await manageReportDescriptor.invoke(ctx, {
      action: "create",
      name: "Exec",
      scope: "boards",
      boardIds: [BOARD_A, BOARD_B],
    });
    expect(r.isError).toBe(true);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });

  // The portfolio branch of the same guard, over the client-injected lookup.
  it("refuses a portfolio in another org", async () => {
    results.set("portfolios:select", {
      data: { org_id: OTHER_ORG },
      error: null,
    });
    const r = await manageReportDescriptor.invoke(ctx, {
      action: "create",
      name: "Roll-up",
      scope: "portfolio",
      portfolioId: PORTFOLIO,
    });
    expect(r.isError).toBe(true);
    expect(opsFor("reports", "insert")).toHaveLength(0);
  });

  it("accepts a portfolio in the caller's org and writes no membership rows", async () => {
    results.set("portfolios:select", { data: { org_id: ORG }, error: null });
    const r = await manageReportDescriptor.invoke(ctx, {
      action: "create",
      name: "Roll-up",
      scope: "portfolio",
      portfolioId: PORTFOLIO,
    });
    expect(r.isError).toBeUndefined();
    // A portfolio report FOLLOWS portfolio_boards — duplicating that set here
    // would let the two drift.
    expect(opsFor("report_boards", "insert")).toHaveLength(0);
  });

  // The scope/binding union in `createReportSchema` is still the one gate.
  it("refuses scope 'board' with no boardId", async () => {
    const r = await manageReportDescriptor.invoke(ctx, {
      action: "create",
      name: "Q3",
      scope: "board",
    });
    expect(r.isError).toBe(true);
  });
});

describe("manage_report save / delete access", () => {
  it("reports a report that does not exist", async () => {
    results.set("reports:select", { data: null, error: null });
    const r = await manageReportDescriptor.invoke(ctx, {
      action: "save",
      reportId: REPORT,
      name: "Q3",
      config: defaultReportConfig(),
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Report not found.");
    expect(opsFor("reports", "update")).toHaveLength(0);
  });

  // The MCP transport gates on the SAME predicate the Server Action does:
  // `resolveReportAccessCore` is the client-injected half of
  // `resolveReportAccess`, not a second implementation.
  it("refuses a caller who is neither creator, org admin, nor board editor", async () => {
    results.set("reports:select", {
      data: {
        id: REPORT,
        org_id: ORG,
        scope: "board",
        board_id: BOARD_A,
        portfolio_id: null,
        name: "Q3",
        config: defaultReportConfig(),
        updated_at: "2026-09-01T00:00:00Z",
        created_by: "someone-else",
      },
      error: null,
    });
    results.set("report_boards:select", {
      data: [{ board_id: BOARD_A }],
      error: null,
    });
    results.set("org_members:select", {
      data: { role: "member" },
      error: null,
    });
    // The board is visible but owned by someone else, with no grant.
    results.set("boards:select", {
      data: [{ id: BOARD_A, created_by: "someone-else" }],
      error: null,
    });

    const r = await manageReportDescriptor.invoke(ctx, {
      action: "delete",
      reportId: REPORT,
    });
    expect(r.isError).toBe(true);
    expect(opsFor("reports", "delete")).toHaveLength(0);
  });

  it("deletes a report the caller created", async () => {
    results.set("reports:select", {
      data: {
        id: REPORT,
        org_id: ORG,
        scope: "board",
        board_id: BOARD_A,
        portfolio_id: null,
        name: "Q3",
        config: defaultReportConfig(),
        updated_at: "2026-09-01T00:00:00Z",
        created_by: USER,
      },
      error: null,
    });
    results.set("report_boards:select", {
      data: [{ board_id: BOARD_A }],
      error: null,
    });
    results.set("org_members:select", {
      data: { role: "member" },
      error: null,
    });

    const r = await manageReportDescriptor.invoke(ctx, {
      action: "delete",
      reportId: REPORT,
    });
    expect(r.isError).toBeUndefined();
    expect(opsFor("reports", "delete")[0].filters).toEqual({ id: REPORT });
    expect(JSON.parse(r.content[0].text)).toEqual({
      reportId: REPORT,
      deleted: true,
    });
  });

  it("rejects an unknown action without opening a client", async () => {
    let opened = false;
    const r = await manageReportDescriptor.invoke(
      {
        actorId: USER,
        getClient: async () => {
          opened = true;
          return {} as never;
        },
      },
      { action: "publish", reportId: REPORT },
    );
    expect(r.isError).toBe(true);
    expect(opened).toBe(false);
  });
});

describe("manage_report classification", () => {
  const actions = ["create", "save", "set_scope", "delete"] as const;

  it("charges board.destroy for delete and board.structure for the rest", () => {
    expect(manageReportDescriptor.capability).toEqual({
      create: "board.structure",
      save: "board.structure",
      set_scope: "board.structure",
      delete: "board.destroy",
    });
  });

  // A report spans one board, many boards, a portfolio, or none at all — there
  // is no single board to narrow on, so RLS plus the per-board edit check is
  // the boundary.
  it("declares scope none for every action", () => {
    for (const action of actions) {
      expect(
        (manageReportDescriptor.scope as Record<string, string>)[action],
        action,
      ).toBe("none");
    }
  });

  it("declares create as an unscoped create", () => {
    expect(manageReportDescriptor.unscopedCreateActions).toEqual(["create"]);
  });

  it("lists every action in the input enum", () => {
    const enumValues = (
      manageReportDescriptor.inputSchema.action as unknown as {
        options: string[];
      }
    ).options;
    expect([...enumValues].sort()).toEqual([...actions].sort());
  });
});
