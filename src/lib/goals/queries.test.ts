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
vi.mock("@/lib/org/active", () => ({ getActiveOrgId: vi.fn(async () => "") }));

import {
  getGoalLinks,
  getGoalsTree,
  getGoalsTreeCore,
  GOALS_LIMIT,
  GOAL_LINKS_LIMIT,
} from "./queries";
import { createClient } from "@/lib/supabase/server";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { getActiveOrgId } from "@/lib/org/active";
import type { RowOwner } from "@/lib/goals/types";

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

/** Two goals in two DIFFERENT orgs. A fixture with one org (or identical
 *  org_ids) cannot tell a real filter apart from no filter at all. */
const GOAL_A = {
  id: "g-a",
  org_id: "org-a",
  parent_goal_id: null,
  name: "Acme: grow revenue",
  description: null,
  owner_id: "u1",
  workspace_id: null,
  progress_mode: "manual",
  status: "on_track",
  start_value: null,
  current_value: null,
  target_value: null,
  unit: null,
  percent: 40,
  start_date: null,
  due_date: null,
  position: 0,
};
const GOAL_B = {
  ...GOAL_A,
  id: "g-b",
  org_id: "org-b",
  name: "Globex: ship v2",
};

/** A client whose `goals` read HONOURS an `.eq("org_id", …)` the way the real
 *  database would, and records whether one was applied. */
function goalsClient(rows: (typeof GOAL_A)[]) {
  const eqCalls: [string, string][] = [];
  const build = (filtered: (typeof GOAL_A)[]) => {
    const chain = {
      eq: (column: string, value: string) => {
        eqCalls.push([column, value]);
        return build(filtered.filter((r) => r.org_id === value));
      },
      order: () => chain,
      limit: () => Promise.resolve({ data: filtered, error: null }),
    };
    return chain;
  };
  return {
    eqCalls,
    client: {
      from: () => ({ select: () => build(rows) }),
      rpc: async () => ({ data: [], error: null }),
    } as never,
  };
}

describe("getGoalsTreeCore org scoping", () => {
  const owners = new Map<string, RowOwner>();

  it("restricts the rows to the requested org", async () => {
    const { client, eqCalls } = goalsClient([GOAL_A, GOAL_B]);
    const nodes = await getGoalsTreeCore(client, {
      owners,
      nowMs: Date.UTC(2026, 0, 5),
      orgId: "org-a",
    });

    expect(eqCalls).toEqual([["org_id", "org-a"]]);
    // Not merely "accepted": org B's goal is GONE from the result.
    expect(nodes.map((n) => n.id)).toEqual(["g-a"]);
  });

  it("applies no org filter when orgId is omitted — the RSC path is unchanged", async () => {
    const { client, eqCalls } = goalsClient([GOAL_A, GOAL_B]);
    const nodes = await getGoalsTreeCore(client, {
      owners,
      nowMs: Date.UTC(2026, 0, 5),
    });

    expect(eqCalls).toEqual([]);
    // /goals shows every org the user belongs to, today and after this change.
    expect(nodes.map((n) => n.id).sort()).toEqual(["g-a", "g-b"]);
  });
});

describe("getGoalsTree owner resolution is not a serial stage", () => {
  it("starts the goals + rollup reads before the owner map resolves", async () => {
    // gotcha-09-adjacent: `createClient()` is process-local, but the owner
    // lookup (a `listOrgMembersCached` miss) is a real round-trip. Awaiting it
    // before issuing the goals read turns max(owners, goals) into
    // owners + goals — a full added RTT on /goals first paint.
    const events: string[] = [];
    let releaseOwners!: () => void;
    const ownersGate = new Promise<void>((r) => (releaseOwners = r));

    vi.mocked(getActiveOrgId).mockResolvedValueOnce("org-a");
    vi.mocked(listOrgMembersCached).mockImplementationOnce(async () => {
      await ownersGate;
      events.push("owners");
      return [];
    });

    const chain = {
      order: () => chain,
      limit: () => {
        events.push("start:goals");
        return Promise.resolve({ data: [], error: null });
      },
    };
    vi.mocked(createClient).mockResolvedValueOnce({
      from: () => ({ select: () => chain }),
      rpc: () => {
        events.push("start:rollup");
        return Promise.resolve({ data: [], error: null });
      },
    } as never);

    const pending = getGoalsTree();
    // Flush microtasks so any concurrent starts get recorded before the gate.
    await Promise.resolve();
    await Promise.resolve();
    releaseOwners();
    await pending;

    expect(events).toContain("owners");
    expect(events.indexOf("start:goals")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("start:goals")).toBeLessThan(
      events.indexOf("owners"),
    );
    expect(events.indexOf("start:rollup")).toBeLessThan(
      events.indexOf("owners"),
    );
  });
});
