import { describe, expect, it, vi } from "vitest";
import { getGoalHandler } from "./get-goal";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async () => ({
    org: { id: "o1", name: "Acme", timezone: "UTC" },
  })),
  listOrgMemberProfiles: vi.fn(async () => []),
}));

const tree = vi.hoisted(() => vi.fn());
vi.mock("@/lib/goals/queries", () => ({
  GOALS_LIMIT: 1000,
  getGoalsTreeCore: tree,
}));

const NODE = {
  id: "g1",
  name: "Grow revenue",
  parentGoalId: null,
  status: "on_track",
  percent: 40,
  dueDate: "2026-12-31",
  owner: null,
  children: [],
};

describe("getGoalHandler", () => {
  it("returns the requested goal with its direct children", async () => {
    tree.mockResolvedValue([NODE]);
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getGoalHandler(getClient, { goalId: "g1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("g1");
    expect(parsed.children).toEqual([]);
  });

  it("errors when the goal is not visible", async () => {
    tree.mockResolvedValue([NODE]);
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getGoalHandler(getClient, { goalId: "missing" });

    // The tree still had to be loaded (over the resolved client) to determine
    // the goal isn't in it — this is a "not found within scope" error, not a
    // guard that short-circuits before resolving a client.
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});
