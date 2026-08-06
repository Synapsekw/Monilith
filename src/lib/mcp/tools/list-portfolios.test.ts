import { describe, expect, it, vi } from "vitest";
import { listPortfoliosHandler } from "./list-portfolios";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolios/queries", () => ({
  PORTFOLIO_LIMIT: 200,
  listPortfoliosCore: core,
}));

describe("listPortfoliosHandler", () => {
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
