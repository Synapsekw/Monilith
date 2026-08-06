import { describe, expect, it, vi } from "vitest";

const limit = vi.fn();
function makeChain(
  rows: unknown[] | null,
  error: { message: string } | null = null,
) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    maybeSingle: async () => ({ data: rows?.[0] ?? null, error }),
    limit: (n: number) => {
      limit(n);
      return chain;
    },
    then: (onF: (r: { data: unknown[] | null; error: unknown }) => unknown) =>
      Promise.resolve({ data: rows, error }).then(onF),
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

import {
  getBoardStatusColumns,
  getPortfolio,
  getPortfolioRows,
  listPortfolios,
  PORTFOLIO_LIMIT,
} from "./queries";
import { createClient } from "@/lib/supabase/server";

describe("listPortfolios", () => {
  it("is bounded", async () => {
    const rows = await listPortfolios();
    expect(limit).toHaveBeenCalledWith(PORTFOLIO_LIMIT);
    expect(rows).toEqual([{ id: "p1", name: "P" }]);
  });

  it("throws when the read fails instead of returning an empty list", async () => {
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => makeChain(null, { message: "db down" }),
    } as never);
    await expect(listPortfolios()).rejects.toThrow(/db down/);
  });
});

describe("getPortfolio", () => {
  it("returns the portfolio row", async () => {
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => makeChain([{ id: "p1", name: "P" }]),
    } as never);
    const p = await getPortfolio("p1");
    expect(p?.id).toBe("p1");
  });

  it("returns null when the portfolio is not visible (RLS) or absent", async () => {
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => makeChain([]),
    } as never);
    expect(await getPortfolio("missing")).toBeNull();
  });

  it("throws when the read fails (DB failure is not a 404)", async () => {
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => makeChain(null, { message: "connection reset" }),
    } as never);
    await expect(getPortfolio("p1")).rejects.toThrow(/connection reset/);
  });
});

describe("getBoardStatusColumns", () => {
  it("throws when the columns read fails instead of returning no columns", async () => {
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => makeChain(null, { message: "columns read failed" }),
    } as never);
    await expect(getBoardStatusColumns("b1")).rejects.toThrow(
      /columns read failed/,
    );
  });
});

function rowsClient(over: {
  placements?: { data: unknown[] | null; error: { message: string } | null };
  rollup?: { data: unknown[] | null; error: { message: string } | null };
}) {
  const placements = over.placements ?? { data: [], error: null };
  const rollup = over.rollup ?? { data: [], error: null };
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "p1", org_id: "org-1", name: "P" },
            error: null,
          }),
          order: () =>
            Promise.resolve(
              table === "portfolio_boards"
                ? placements
                : { data: [], error: null },
            ),
        }),
      }),
    }),
    rpc: () => Promise.resolve(rollup),
  };
}

describe("getPortfolioRows", () => {
  it("resolves the org via a head read first, then fires placements and rollup concurrently", async () => {
    // Task 6 (mcp-full-surface): getPortfolioRowsCore takes `owners` as a ctx
    // param instead of resolving them internally (MCP must stay off the
    // service client `listOrgMembersCached` uses), so the RSC wrapper now
    // needs org_id BEFORE it can build the owner map and call the core. That
    // replaces the old single-Promise.all waterfall collapse with a cheap
    // sequential head read up front — see the comment on getPortfolioRows in
    // queries.ts. This test asserts the new order instead of the old
    // single-stage concurrency.
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
    // The head read (org lookup, gated in this test) must complete before
    // placements/rollup are even started — they're inside the core, which is
    // only invoked once the owner map is built from head.org_id.
    const firstPortfolio = order.indexOf("portfolio");
    expect(firstPortfolio).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("start:portfolio_boards")).toBeGreaterThan(
      firstPortfolio,
    );
    expect(order.indexOf("start:portfolio_rollup")).toBeGreaterThan(
      firstPortfolio,
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

  it("throws when the placements read fails instead of rendering an empty grid", async () => {
    vi.mocked(createClient).mockResolvedValue(
      rowsClient({
        placements: { data: null, error: { message: "placements failed" } },
      }) as never,
    );
    await expect(getPortfolioRows("p1")).rejects.toThrow(/placements failed/);
  });

  it("throws when the rollup read fails instead of rendering an empty grid", async () => {
    vi.mocked(createClient).mockResolvedValue(
      rowsClient({
        rollup: { data: null, error: { message: "rollup failed" } },
      }) as never,
    );
    await expect(getPortfolioRows("p1")).rejects.toThrow(/rollup failed/);
  });
});
