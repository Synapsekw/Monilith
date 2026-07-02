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

import {
  listPortfolios,
  listReadableBoards,
  PORTFOLIO_LIMIT,
  READABLE_BOARDS_LIMIT,
} from "./queries";

describe("listPortfolios", () => {
  it("is bounded", async () => {
    const rows = await listPortfolios();
    expect(limit).toHaveBeenCalledWith(PORTFOLIO_LIMIT);
    expect(rows).toEqual([{ id: "p1", name: "P" }]);
  });
});

describe("listReadableBoards", () => {
  it("is bounded", async () => {
    limit.mockClear();
    await listReadableBoards();
    expect(limit).toHaveBeenCalledWith(READABLE_BOARDS_LIMIT);
  });
});
