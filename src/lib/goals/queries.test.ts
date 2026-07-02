import { describe, expect, it, vi } from "vitest";

const limits: number[] = [];
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    limit: (n: number) => {
      limits.push(n);
      return chain;
    },
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF),
  };
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => makeChain([]),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  })),
}));
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: vi.fn(async () => []),
}));
vi.mock("@/lib/auth/session", () => ({ getUserOrgs: vi.fn(async () => []) }));

import {
  getGoalLinks,
  getGoalsTree,
  GOALS_LIMIT,
  GOAL_LINKS_LIMIT,
} from "./queries";

describe("goals reads are bounded", () => {
  it("getGoalLinks applies the links cap", async () => {
    limits.length = 0;
    await getGoalLinks();
    expect(limits).toContain(GOAL_LINKS_LIMIT);
  });

  it("getGoalsTree applies the goals cap", async () => {
    limits.length = 0;
    await getGoalsTree();
    expect(limits).toContain(GOALS_LIMIT);
  });
});
