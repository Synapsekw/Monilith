import { describe, expect, it, vi } from "vitest";

const limit = vi.fn();
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    limit: (n: number) => {
      limit(n);
      return chain;
    },
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF),
  };
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => makeChain([{ id: "p1", name: "P" }]),
  })),
}));
// the cached-members import inside portfolios/queries.ts must not explode at import time
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: vi.fn(async () => []),
}));

import { getPortfolioRows, listPortfolios, PORTFOLIO_LIMIT } from "./queries";
import { createClient } from "@/lib/supabase/server";

describe("listPortfolios", () => {
  it("is bounded", async () => {
    const rows = await listPortfolios();
    expect(limit).toHaveBeenCalledWith(PORTFOLIO_LIMIT);
    expect(rows).toEqual([{ id: "p1", name: "P" }]);
  });
});

describe("getPortfolioRows", () => {
  it("fires portfolio, placements, and rollup concurrently (single stage before members)", async () => {
    const order: string[] = [];
    // The portfolio read (maybeSingle) resolves on a deferred promise;
    // placements/rollup must have been INITIATED before it resolves.
    let releasePortfolio!: () => void;
    const portfolioGate = new Promise<void>((r) => (releasePortfolio = r));
    const client = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              await portfolioGate;
              order.push("portfolio");
              return {
                data: { id: "p1", org_id: "org-1", name: "P" },
                error: null,
              };
            },
            order: () => {
              order.push(`start:${table}`);
              return Promise.resolve({ data: [], error: null });
            },
          }),
        }),
      }),
      rpc: (name: string) => {
        order.push(`start:${name}`);
        return Promise.resolve({ data: [], error: null });
      },
    };
    vi.mocked(createClient).mockResolvedValue(client as never);

    const pending = getPortfolioRows("p1");
    // Flush microtasks so parallel starts get recorded before the gate opens.
    await Promise.resolve();
    await Promise.resolve();
    releasePortfolio();
    const result = await pending;

    expect(order.filter((e) => e.startsWith("start:"))).toEqual(
      expect.arrayContaining([
        "start:portfolio_boards",
        "start:portfolio_rollup",
      ]),
    );
    expect(order.indexOf("start:portfolio_rollup")).toBeLessThan(
      order.indexOf("portfolio"),
    );
    expect(result?.portfolio.id).toBe("p1");
  });

  it("returns null when the portfolio is not visible (RLS) or absent", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
      rpc: () => Promise.resolve({ data: [], error: null }),
    };
    vi.mocked(createClient).mockResolvedValue(client as never);
    expect(await getPortfolioRows("missing")).toBeNull();
  });
});
