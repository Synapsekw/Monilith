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

// Three levels deep: ROOT -> CHILD -> GRANDCHILD. `findGoal` must descend
// more than one level to reach GRANDCHILD, and the child-summary projection
// on ROOT must include CHILD but must NOT flatten GRANDCHILD into it.
const GRANDCHILD = {
  id: "g3",
  name: "Sign 3 enterprise deals",
  parentGoalId: "g2",
  status: "off_track",
  percent: 5,
  dueDate: null,
  owner: null,
  children: [],
};

const CHILD = {
  id: "g2",
  name: "Land 10 logos",
  parentGoalId: "g1",
  status: "at_risk",
  percent: 10,
  dueDate: "2026-11-30",
  owner: null,
  children: [GRANDCHILD],
};

const ROOT = {
  id: "g1",
  name: "Grow revenue",
  parentGoalId: null,
  status: "on_track",
  percent: 40,
  dueDate: "2026-12-31",
  owner: null,
  children: [CHILD],
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

  it("finds a grandchild two levels deep and projects it correctly", async () => {
    tree.mockResolvedValue([ROOT]);
    const getClient = vi.fn(async () => ({}) as never);
    // Request the grandchild directly. `findGoal` only reaches it by
    // recursing into ROOT.children, then into CHILD.children — a lookup
    // that stopped after one level would return null and this would 404.
    const result = await getGoalHandler(getClient, { goalId: "g3" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("g3");
    expect(parsed.name).toBe("Sign 3 enterprise deals");
    expect(parsed.parentId).toBe("g2");
    expect(parsed.status).toBe("off_track");
    expect(parsed.percent).toBe(5);
    // The grandchild has no children of its own.
    expect(parsed.children).toEqual([]);
  });

  it("summarizes only direct children for the root, not deeper descendants", async () => {
    tree.mockResolvedValue([ROOT]);
    const getClient = vi.fn(async () => ({}) as never);
    const result = await getGoalHandler(getClient, { goalId: "g1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("g1");
    // Exactly the direct-child summary shape — a wrong field mapping (or a
    // leaked grandchild) would break this exact-equality check.
    expect(parsed.children).toEqual([
      { id: "g2", name: "Land 10 logos", percent: 10, status: "at_risk" },
    ]);
    // The grandchild's id must not appear anywhere in the summary array —
    // the projection is one level deep by design.
    expect(parsed.children.some((c: { id: string }) => c.id === "g3")).toBe(
      false,
    );
  });
});
