import { describe, expect, it, vi } from "vitest";
import { listPortfoliosHandler } from "./list-portfolios";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolios/queries", () => ({
  PORTFOLIO_LIMIT: 200,
  listPortfoliosCore: core,
}));

describe("listPortfoliosHandler", () => {
  it("returns portfolios with a board count", async () => {
    core.mockResolvedValue([{ id: "p1", name: "Q1 delivery" }]);
    const client = {
      from: () => ({
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [{ portfolio_id: "p1" }, { portfolio_id: "p1" }],
              error: null,
            }),
        }),
      }),
    };
    const getClient = vi.fn(async () => client as never);

    const result = await listPortfoliosHandler(getClient);

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      { id: "p1", name: "Q1 delivery", boardCount: 2 },
    ]);
  });

  it("returns an empty array when there are no portfolios", async () => {
    core.mockResolvedValue([]);
    const result = await listPortfoliosHandler(async () => ({}) as never);
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});
