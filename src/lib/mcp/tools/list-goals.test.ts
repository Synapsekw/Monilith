import { describe, expect, it, vi } from "vitest";
import { listGoalsHandler } from "./list-goals";

vi.mock("@/lib/mcp/org-scope", () => ({
  resolveOrgForTool: vi.fn(async () => ({
    org: { id: "o1", name: "Acme", timezone: "UTC" },
  })),
  listOrgMemberProfiles: vi.fn(async () => [
    { userId: "u1", fullName: "Ada", avatarUrl: null },
  ]),
}));

const tree = vi.hoisted(() => vi.fn());
vi.mock("@/lib/goals/queries", () => ({
  GOALS_LIMIT: 1000,
  getGoalsTreeCore: tree,
}));

describe("listGoalsHandler", () => {
  it("flattens the tree with depth and drops UI-only fields", async () => {
    tree.mockResolvedValue([
      {
        id: "g1",
        name: "Grow revenue",
        parentGoalId: null,
        status: "on_track",
        percent: 40,
        dueDate: "2026-12-31",
        owner: { userId: "u1", fullName: "Ada", avatarUrl: "http://x/y.png" },
        children: [
          {
            id: "g2",
            name: "Land 10 logos",
            parentGoalId: "g1",
            status: "at_risk",
            percent: 10,
            dueDate: null,
            owner: null,
            children: [],
          },
        ],
      },
    ]);

    const getClient = vi.fn(async () => ({}) as never);
    const result = await listGoalsHandler(getClient, {});

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual([
      {
        id: "g1",
        name: "Grow revenue",
        parentId: null,
        depth: 0,
        percent: 40,
        status: "on_track",
        ownerName: "Ada",
        dueDate: "2026-12-31",
      },
      {
        id: "g2",
        name: "Land 10 logos",
        parentId: "g1",
        depth: 1,
        percent: 10,
        status: "at_risk",
        ownerName: null,
        dueDate: null,
      },
    ]);
  });
});
