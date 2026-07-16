import { describe, expect, it } from "vitest";
import { applyGoalPatch } from "./patch";
import type { GoalNode } from "./types";
import type { Tables } from "@/types/database.types";

function node(over: Partial<GoalNode>): GoalNode {
  return {
    id: "g1",
    parentGoalId: null,
    name: "Goal",
    description: null,
    ownerId: "u1",
    workspaceId: null,
    progressMode: "manual_percent",
    status: "on_track",
    startValue: null,
    currentValue: null,
    targetValue: null,
    unit: null,
    percent: 20,
    startDate: null,
    dueDate: null,
    position: 0,
    children: [],
    progress: 0.2,
    autoHealth: null,
    owner: null,
    ...over,
  };
}
function row(over: Partial<Tables<"goals">>): Tables<"goals"> {
  return {
    id: "g1",
    name: "Goal",
    description: null,
    owner_id: "u1",
    workspace_id: null,
    parent_goal_id: null,
    progress_mode: "manual_percent",
    status: "on_track",
    start_value: null,
    current_value: null,
    target_value: null,
    unit: null,
    percent: 20,
    start_date: null,
    due_date: null,
    position: 0,
    ...over,
  } as Tables<"goals">;
}

describe("applyGoalPatch", () => {
  it("patches fields and recomputes manual_percent progress", () => {
    const next = applyGoalPatch([node({})], row({ percent: 80 }));
    expect(next[0].percent).toBe(80);
    expect(next[0].progress).toBeCloseTo(0.8);
  });
  it("rolls a child's new progress up into an auto_subgoals parent", () => {
    const tree = [
      node({
        id: "parent",
        progressMode: "auto_subgoals",
        percent: null,
        progress: 0.2,
        children: [node({ id: "g1", parentGoalId: "parent" })],
      }),
    ];
    const next = applyGoalPatch(tree, row({ percent: 100 }));
    expect(next[0].children[0].progress).toBeCloseTo(1);
    expect(next[0].progress).toBeCloseTo(1);
  });
  it("leaves auto_boards progress untouched (server-derived rollup)", () => {
    const tree = [
      node({ progressMode: "auto_boards", percent: null, progress: 0.5 }),
    ];
    const next = applyGoalPatch(
      tree,
      row({ progress_mode: "auto_boards", name: "Renamed", percent: null }),
    );
    expect(next[0].name).toBe("Renamed");
    expect(next[0].progress).toBe(0.5);
  });
});
