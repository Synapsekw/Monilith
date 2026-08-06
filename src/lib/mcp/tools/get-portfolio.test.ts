import { describe, expect, it, vi } from "vitest";
import { getPortfolioHandler } from "./get-portfolio";

vi.mock("@/lib/mcp/org-scope", () => ({
  listOrgMemberProfiles: vi.fn(async () => [
    { userId: "u1", fullName: "Ada", avatarUrl: null },
  ]),
}));

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolios/queries", () => ({ getPortfolioRowsCore: core }));

function clientWithHead(head: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: head, error: null }) }),
      }),
    }),
  };
}

describe("getPortfolioHandler", () => {
  it("projects rollup rows without UI placement fields", async () => {
    core.mockResolvedValue({
      portfolio: { id: "p1", name: "Q1 delivery", org_id: "o1" },
      rows: [
        {
          boardId: "b1",
          name: "Roadmap",
          totalItems: 10,
          doneItems: 4,
          overdueItems: 1,
          health: "at_risk",
          owner: { userId: "u1", fullName: "Ada", avatarUrl: null },
        },
      ],
    });

    const getClient = vi.fn(
      async () => clientWithHead({ id: "p1", org_id: "o1" }) as never,
    );
    const result = await getPortfolioHandler(getClient, { portfolioId: "p1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    // The rollup RPC runs exactly once — the head read is a separate cheap query.
    expect(core).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Q1 delivery");
    expect(parsed.boards[0]).toEqual({
      boardId: "b1",
      boardName: "Roadmap",
      totalItems: 10,
      doneItems: 4,
      overdueItems: 1,
      health: "at_risk",
      ownerName: "Ada",
    });
  });

  it("errors when the portfolio is not visible, without running the rollup", async () => {
    core.mockClear();
    const getClient = vi.fn(async () => clientWithHead(null) as never);
    const result = await getPortfolioHandler(getClient, {
      portfolioId: "missing",
    });
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(core).not.toHaveBeenCalled();
  });
});
