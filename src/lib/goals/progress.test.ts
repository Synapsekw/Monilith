import { describe, expect, it } from "vitest";
import { buildGoalTree, computeGoalHealth, leafProgress } from "@/lib/goals/progress";
import type { BoardAgg, GoalRow } from "@/lib/goals/types";

const base: Omit<GoalRow, "id" | "progressMode"> = {
  parentGoalId: null,
  name: "G",
  description: null,
  ownerId: "u1",
  workspaceId: null,
  status: "on_track",
  startValue: null,
  currentValue: null,
  targetValue: null,
  unit: null,
  percent: null,
  startDate: null,
  dueDate: null,
  position: 0,
};
const row = (over: Partial<GoalRow> & { id: string }): GoalRow => ({
  ...base,
  progressMode: "manual_percent",
  ...over,
});

describe("leafProgress", () => {
  it("manual_number: (current-start)/(target-start), clamped", () => {
    expect(
      leafProgress(
        row({ id: "a", progressMode: "manual_number", startValue: 0, currentValue: 25, targetValue: 100 }),
        [],
      ),
    ).toBe(0.25);
  });
  it("manual_number: null when target === start", () => {
    expect(
      leafProgress(
        row({ id: "a", progressMode: "manual_number", startValue: 10, currentValue: 10, targetValue: 10 }),
        [],
      ),
    ).toBeNull();
  });
  it("manual_percent: percent/100", () => {
    expect(leafProgress(row({ id: "a", progressMode: "manual_percent", percent: 60 }), [])).toBe(0.6);
  });
  it("auto_boards: sum(done)/sum(total) across this goal's aggregates", () => {
    const aggs: BoardAgg[] = [
      { goalId: "a", boardId: "b1", total: 4, done: 1 },
      { goalId: "a", boardId: "b2", total: 6, done: 2 },
    ];
    expect(leafProgress(row({ id: "a", progressMode: "auto_boards" }), aggs)).toBeCloseTo(0.3);
  });
  it("auto_boards: null when there are no items", () => {
    expect(leafProgress(row({ id: "a", progressMode: "auto_boards" }), [])).toBeNull();
  });
  it("auto_subgoals: leaf returns null (resolved during roll-up)", () => {
    expect(leafProgress(row({ id: "a", progressMode: "auto_subgoals" }), [])).toBeNull();
  });
});

describe("computeGoalHealth", () => {
  it("off_track when past due and unfinished", () => {
    expect(
      computeGoalHealth({ progress: 0.5, startDate: "2026-01-01", dueDate: "2026-06-01", today: "2026-06-21" }),
    ).toBe("off_track");
  });
  it("at_risk when behind pace", () => {
    expect(
      computeGoalHealth({ progress: 0.1, startDate: "2026-01-01", dueDate: "2026-12-31", today: "2026-07-01" }),
    ).toBe("at_risk");
  });
  it("on_track when ahead of pace", () => {
    expect(
      computeGoalHealth({ progress: 0.9, startDate: "2026-01-01", dueDate: "2026-12-31", today: "2026-03-01" }),
    ).toBe("on_track");
  });
  it("null when no signal", () => {
    expect(
      computeGoalHealth({ progress: null, startDate: null, dueDate: null, today: "2026-06-21" }),
    ).toBeNull();
  });
});

describe("buildGoalTree", () => {
  it("rolls auto_subgoals up as the equal-weight mean of children", () => {
    const rows: GoalRow[] = [
      row({ id: "root", progressMode: "auto_subgoals" }),
      row({ id: "c1", parentGoalId: "root", progressMode: "manual_percent", percent: 40, position: 0 }),
      row({ id: "c2", parentGoalId: "root", progressMode: "manual_percent", percent: 80, position: 1 }),
    ];
    const tree = buildGoalTree(rows, [], new Map(), "2026-06-21");
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("root");
    expect(tree[0].progress).toBeCloseTo(0.6);
    expect(tree[0].children.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
  it("excludes children with null progress from the mean", () => {
    const rows: GoalRow[] = [
      row({ id: "root", progressMode: "auto_subgoals" }),
      row({ id: "c1", parentGoalId: "root", progressMode: "manual_percent", percent: 50 }),
      row({ id: "c2", parentGoalId: "root", progressMode: "auto_boards" }), // null (no items)
    ];
    const tree = buildGoalTree(rows, [], new Map(), "2026-06-21");
    expect(tree[0].progress).toBeCloseTo(0.5);
  });
  it("cascades through three levels (post-order)", () => {
    const rows: GoalRow[] = [
      row({ id: "co", progressMode: "auto_subgoals" }),
      row({ id: "team", parentGoalId: "co", progressMode: "auto_subgoals" }),
      row({ id: "ic", parentGoalId: "team", progressMode: "manual_number", startValue: 0, currentValue: 50, targetValue: 100 }),
    ];
    const tree = buildGoalTree(rows, [], new Map(), "2026-06-21");
    expect(tree[0].progress).toBeCloseTo(0.5);
    expect(tree[0].children[0].progress).toBeCloseTo(0.5);
  });
});
