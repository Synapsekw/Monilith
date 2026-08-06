import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPortfoliosHandler } from "./list-portfolios";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async (_c: unknown, requested?: string) =>
    requested === "o-foreign"
      ? { error: "You are not a member of organization o-foreign." }
      : { org: { id: "o1", name: "Acme", timezone: "UTC" } },
  ),
}));

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolios/queries", () => ({
  PORTFOLIO_LIMIT: 200,
  listPortfoliosCore: core,
}));

describe("listPortfoliosHandler", () => {
  beforeEach(() => {
    core.mockReset();
  });

  it("passes the RESOLVED org id down to the core, not just validating it", async () => {
    // Validating membership without scoping the query is the I3 defect: RLS
    // returns every org the caller belongs to, so a two-org user asking about
    // Acme would get the other client's portfolios reported as Acme's.
    core.mockResolvedValue([]);
    const result = await listPortfoliosHandler(async () => ({}) as never, {
      orgId: "o1",
    });

    expect(core).toHaveBeenCalledTimes(1);
    expect(core).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "o1" }),
    );
    expect(result.isError).toBeUndefined();
  });

  it("surfaces a foreign orgId as an error without reaching the core", async () => {
    const getClient = vi.fn(async () => ({}) as never);
    const result = await listPortfoliosHandler(getClient, {
      orgId: "o-foreign",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(core).not.toHaveBeenCalled();
  });

  it("returns board counts for TWO portfolios from ONE grouped query", async () => {
    core.mockResolvedValue([
      { id: "p1", name: "Q1 delivery" },
      { id: "p2", name: "Q2 delivery" },
    ]);
    // Distinct rows per portfolio_id — a fixture with a single portfolio (or
    // identical rows per id) can't tell a correct grouped query apart from an
    // N+1 implementation that queries once per portfolio, since either would
    // produce the same output. Filtering by the `ids` the mock is actually
    // called with also means an N+1 caller gets right per-call answers but is
    // still caught by the call-count assertion below.
    const allRows = [
      { portfolio_id: "p1" },
      { portfolio_id: "p1" },
      { portfolio_id: "p2" },
    ];
    const inSpy = vi.fn((_column: string, ids: string[]) =>
      Promise.resolve({
        data: allRows.filter((r) => ids.includes(r.portfolio_id)),
        error: null,
      }),
    );
    const client = {
      from: () => ({
        select: () => ({
          in: inSpy,
        }),
      }),
    };
    const getClient = vi.fn(async () => client as never);

    const result = await listPortfoliosHandler(getClient);

    expect(getClient).toHaveBeenCalledTimes(1);
    // ONE grouped read over ALL portfolio ids — never one query per portfolio.
    expect(inSpy).toHaveBeenCalledTimes(1);
    expect(inSpy).toHaveBeenCalledWith("portfolio_id", ["p1", "p2"]);
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "p1", name: "Q1 delivery", boardCount: 2 },
      { id: "p2", name: "Q2 delivery", boardCount: 1 },
    ]);
  });

  it("returns an empty array when there are no portfolios", async () => {
    core.mockResolvedValue([]);
    const result = await listPortfoliosHandler(async () => ({}) as never);
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});
