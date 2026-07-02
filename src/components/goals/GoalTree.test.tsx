import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { GoalTree } from "./GoalTree";
import type { GoalNode } from "@/lib/goals/types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

function makeNode(overrides: Partial<GoalNode>): GoalNode {
  return {
    id: "g",
    parentGoalId: null,
    name: "Goal",
    description: null,
    ownerId: "u1",
    workspaceId: null,
    progressMode: "auto_subgoals",
    status: "on_track",
    startValue: null,
    currentValue: null,
    targetValue: null,
    unit: null,
    percent: null,
    startDate: null,
    dueDate: null,
    position: 0,
    children: [],
    progress: 0.5,
    autoHealth: null,
    owner: null,
    ...overrides,
  };
}

const child = makeNode({ id: "g2", name: "Child goal" });
const parent = makeNode({ id: "g1", name: "Parent goal", children: [child] });

test("row expand and open controls carry the branded focus ring", () => {
  render(<GoalTree tree={[parent]} />);
  const chevron = screen.getByRole("button", { name: /collapse|expand/i });
  expect(chevron.className).toContain("focus-visible:ring");
  expect(chevron.className).toContain("transition-colors");
  const name = screen.getByRole("button", { name: "Parent goal" });
  expect(name.className).toContain("focus-visible:ring");
});

test("data rows transition their hover background", () => {
  render(<GoalTree tree={[parent]} />);
  const row = screen.getByRole("button", { name: "Parent goal" }).closest("tr");
  expect(row!.className).toContain("hover:bg-accent/30");
  expect(row!.className).toContain("transition-colors");
});
