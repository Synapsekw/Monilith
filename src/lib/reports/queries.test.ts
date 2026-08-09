import { describe, expect, it } from "vitest";
import {
  getReportCore,
  listReportsForBoardCore,
  listReportsForOrgCore,
  listReportTemplatesCore,
  resolveReportBoardIdsCore,
  REPORTS_LIMIT,
  REPORT_BOARDS_LIMIT,
  type ReportRow,
} from "./queries";
import { defaultReportConfig } from "./config";

/**
 * Hand-rolled Supabase fake (house style — see src/test/mcp-fake-client.ts and
 * src/lib/dashboards/queries.test.ts). It RECORDS the query it was asked to
 * build so the tests can assert the table, the filters, the ordering and the
 * bound, then resolves with canned rows per table.
 */
type Recorded = {
  table: string;
  select: string;
  eq: [string, unknown][];
  neq: [string, unknown][];
  order: { column: string; ascending?: boolean }[];
  limit?: number;
};

function makeFake(rowsByTable: Record<string, unknown[]> = {}) {
  const ops: Recorded[] = [];
  const client = {
    from(table: string) {
      const op: Recorded = {
        table,
        select: "",
        eq: [],
        neq: [],
        order: [],
      };
      ops.push(op);
      const rows = () => ({ data: rowsByTable[table] ?? [], error: null });
      const chain = {
        select(cols: string) {
          op.select = cols;
          return chain;
        },
        eq(column: string, value: unknown) {
          op.eq.push([column, value]);
          return chain;
        },
        neq(column: string, value: unknown) {
          op.neq.push([column, value]);
          return chain;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          op.order.push({ column, ...(opts ?? {}) });
          return chain;
        },
        limit(n: number) {
          op.limit = n;
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({
            data: (rowsByTable[table] ?? [])[0] ?? null,
            error: null,
          });
        },
        // The builder is awaited directly for list reads.
        then<T>(onF: (r: { data: unknown[]; error: null }) => T) {
          return Promise.resolve(rows()).then(onF);
        },
      };
      return chain;
    },
  };
  // `never` is assignable to SupabaseClient<Database> — the same structural-fake
  // escape hatch used by src/test/mcp-fake-client.ts.
  return { client: client as never, ops };
}

function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    org_id: "o1",
    scope: "board",
    board_id: "b1",
    portfolio_id: null,
    name: "Weekly status",
    config: { v: 1, title: "Weekly status", blocks: [] },
    updated_at: "2026-08-09T00:00:00.000Z",
    ...over,
  };
}

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "r1",
    orgId: "o1",
    scope: "board",
    boardId: "b1",
    portfolioId: null,
    name: "Weekly status",
    config: defaultReportConfig(),
    updatedAt: "2026-08-09T00:00:00.000Z",
    ...over,
  };
}

describe("getReportCore", () => {
  it("reads the reports row by id and maps it to camelCase", async () => {
    const { client, ops } = makeFake({
      reports: [
        dbRow({ scope: "portfolio", board_id: null, portfolio_id: "p1" }),
      ],
    });
    const row = await getReportCore(client, "r1");

    expect(ops[0].table).toBe("reports");
    expect(ops[0].eq).toEqual([["id", "r1"]]);
    expect(row).toMatchObject({
      id: "r1",
      orgId: "o1",
      scope: "portfolio",
      boardId: null,
      portfolioId: "p1",
      name: "Weekly status",
      updatedAt: "2026-08-09T00:00:00.000Z",
    });
    // Config always comes back parsed, never raw JSON.
    expect(row?.config.v).toBe(1);
  });

  it("selects every column the ReportRow needs (scope + both bindings)", async () => {
    const { client, ops } = makeFake({ reports: [dbRow()] });
    await getReportCore(client, "r1");
    for (const col of [
      "id",
      "org_id",
      "scope",
      "board_id",
      "portfolio_id",
      "name",
      "config",
      "updated_at",
    ]) {
      expect(ops[0].select).toContain(col);
    }
  });

  it("returns null when the row is absent or RLS-hidden", async () => {
    const { client } = makeFake({ reports: [] });
    expect(await getReportCore(client, "nope")).toBeNull();
  });

  it("falls back to 'board' for an unrecognised scope string", async () => {
    const { client } = makeFake({ reports: [dbRow({ scope: "wat" })] });
    expect((await getReportCore(client, "r1"))?.scope).toBe("board");
  });
});

describe("listReportsForBoardCore", () => {
  it("filters through report_boards with an inner join, not reports.board_id", async () => {
    const { client, ops } = makeFake({ reports: [dbRow()] });
    await listReportsForBoardCore(client, "b1");

    expect(ops).toHaveLength(1);
    expect(ops[0].table).toBe("reports");
    expect(ops[0].select).toContain("report_boards!inner(board_id)");
    expect(ops[0].eq).toEqual([["report_boards.board_id", "b1"]]);
    // A roll-up that merely *includes* b1 must show up, so the legacy
    // `reports.board_id = b1` filter must be gone.
    expect(ops[0].eq).not.toContainEqual(["board_id", "b1"]);
  });

  it("excludes templates, orders newest-first and applies the default bound", async () => {
    const { client, ops } = makeFake({ reports: [dbRow()] });
    await listReportsForBoardCore(client, "b1");

    expect(ops[0].neq).toEqual([["scope", "template"]]);
    expect(ops[0].order).toEqual([{ column: "updated_at", ascending: false }]);
    expect(ops[0].limit).toBe(REPORTS_LIMIT);
  });

  it("honours an explicit limit", async () => {
    const { client, ops } = makeFake({ reports: [] });
    await listReportsForBoardCore(client, "b1", 5);
    expect(ops[0].limit).toBe(5);
  });

  it("maps every row and tolerates an empty/absent result", async () => {
    const { client } = makeFake({
      reports: [dbRow(), dbRow({ id: "r2", scope: "boards", board_id: null })],
    });
    const rows = await listReportsForBoardCore(client, "b1");
    expect(rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(rows[1].scope).toBe("boards");

    const empty = makeFake();
    expect(await listReportsForBoardCore(empty.client, "b1")).toEqual([]);
  });
});

describe("listReportsForOrgCore", () => {
  it("scopes to the org, excludes templates and bounds the read by default", async () => {
    const { client, ops } = makeFake({ reports: [dbRow()] });
    await listReportsForOrgCore(client, "o1");

    expect(ops[0].table).toBe("reports");
    expect(ops[0].eq).toEqual([["org_id", "o1"]]);
    expect(ops[0].neq).toEqual([["scope", "template"]]);
    expect(ops[0].order).toEqual([{ column: "updated_at", ascending: false }]);
    expect(ops[0].limit).toBe(REPORTS_LIMIT);
  });

  it("keeps templates in when includeTemplates is set", async () => {
    const { client, ops } = makeFake({ reports: [dbRow()] });
    await listReportsForOrgCore(client, "o1", { includeTemplates: true });
    expect(ops[0].neq).toEqual([]);
  });

  it("honours an explicit limit", async () => {
    const { client, ops } = makeFake({ reports: [] });
    await listReportsForOrgCore(client, "o1", { limit: 7 });
    expect(ops[0].limit).toBe(7);
  });
});

describe("listReportTemplatesCore", () => {
  it("reads only scope='template' rows for the org, newest-first and bounded", async () => {
    const { client, ops } = makeFake({
      reports: [
        dbRow({ id: "t1", scope: "template", board_id: null, name: "QBR" }),
      ],
    });
    const rows = await listReportTemplatesCore(client, "o1");

    expect(ops[0].table).toBe("reports");
    expect(ops[0].eq).toEqual([
      ["org_id", "o1"],
      ["scope", "template"],
    ]);
    expect(ops[0].order).toEqual([{ column: "updated_at", ascending: false }]);
    expect(ops[0].limit).toBe(REPORTS_LIMIT);
    expect(rows[0]).toMatchObject({ id: "t1", scope: "template" });
  });

  it("honours an explicit limit", async () => {
    const { client, ops } = makeFake({ reports: [] });
    await listReportTemplatesCore(client, "o1", 3);
    expect(ops[0].limit).toBe(3);
  });
});

describe("resolveReportBoardIdsCore", () => {
  it("returns [] for a template WITHOUT touching the database", async () => {
    const { client, ops } = makeFake({ report_boards: [{ board_id: "b1" }] });
    expect(
      await resolveReportBoardIdsCore(client, report({ scope: "template" })),
    ).toEqual([]);
    expect(ops).toEqual([]);
  });

  it("reads report_boards by report id, ordered by position, for scope='board'", async () => {
    const { client, ops } = makeFake({
      report_boards: [{ board_id: "b1" }],
    });
    const ids = await resolveReportBoardIdsCore(client, report());

    expect(ops[0].table).toBe("report_boards");
    expect(ops[0].select).toBe("board_id");
    expect(ops[0].eq).toEqual([["report_id", "r1"]]);
    expect(ops[0].order).toEqual([{ column: "position", ascending: true }]);
    expect(ops[0].limit).toBe(REPORT_BOARDS_LIMIT);
    expect(ids).toEqual(["b1"]);
  });

  it("reads report_boards for scope='boards' and preserves position order", async () => {
    const { client, ops } = makeFake({
      report_boards: [
        { board_id: "b3" },
        { board_id: "b1" },
        { board_id: "b2" },
      ],
    });
    const ids = await resolveReportBoardIdsCore(
      client,
      report({ scope: "boards", boardId: null }),
    );

    expect(ops[0].table).toBe("report_boards");
    expect(ids).toEqual(["b3", "b1", "b2"]);
  });

  it("resolves through portfolio_boards for scope='portfolio'", async () => {
    const { client, ops } = makeFake({
      portfolio_boards: [{ board_id: "b7" }, { board_id: "b8" }],
      report_boards: [{ board_id: "should-not-be-used" }],
    });
    const ids = await resolveReportBoardIdsCore(
      client,
      report({ scope: "portfolio", boardId: null, portfolioId: "p1" }),
    );

    expect(ops).toHaveLength(1);
    expect(ops[0].table).toBe("portfolio_boards");
    expect(ops[0].select).toBe("board_id");
    expect(ops[0].eq).toEqual([["portfolio_id", "p1"]]);
    expect(ops[0].order).toEqual([{ column: "position", ascending: true }]);
    expect(ops[0].limit).toBe(REPORT_BOARDS_LIMIT);
    expect(ids).toEqual(["b7", "b8"]);
  });

  it("returns [] for a portfolio report with no portfolio bound", async () => {
    const { client, ops } = makeFake({
      portfolio_boards: [{ board_id: "b7" }],
    });
    expect(
      await resolveReportBoardIdsCore(
        client,
        report({ scope: "portfolio", boardId: null, portfolioId: null }),
      ),
    ).toEqual([]);
    expect(ops).toEqual([]);
  });

  it("bounds every branch at REPORT_BOARDS_LIMIT", () => {
    expect(REPORT_BOARDS_LIMIT).toBe(50);
    expect(REPORTS_LIMIT).toBe(100);
  });
});
