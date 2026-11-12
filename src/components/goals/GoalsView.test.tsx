import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoalsView } from "./GoalsView";
import type { GoalNode } from "@/lib/goals/types";

vi.mock("@/lib/goals/actions", () => ({
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  setGoalLinks: vi.fn(),
  getStatusColumnsForBoard: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const goal: GoalNode = {
  id: "g1",
  parentGoalId: null,
  name: "Ship v1",
  description: null,
  ownerId: "u1",
  workspaceId: null,
  progressMode: "manual_percent",
  status: "on_track",
  startValue: null,
  currentValue: null,
  targetValue: null,
  unit: null,
  percent: 50,
  startDate: null,
  dueDate: null,
  position: 0,
  children: [],
  progress: 0.5,
  autoHealth: null,
  owner: null,
};

describe("GoalsView empty org", () => {
  it("shows Mono, what will appear, and the existing New goal dialog trigger", () => {
    const { container } = render(
      <GoalsView tree={[]} members={[]} boards={[]} links={{}} />,
    );

    expect(container.querySelector("svg[data-mood]")).not.toBeNull();
    expect(screen.getByText("Your goals will appear here")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create a goal to track a measurable objective across your org.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New goal" }),
    ).toBeInTheDocument();
    // No empty table, no sort bar over nothing — and no mascot in a table.
    expect(container.querySelector("table")).toBeNull();
    expect(screen.queryByText("Sort by")).toBeNull();
  });

  it("shows the tree, and no mascot, once there is a goal", () => {
    const { container } = render(
      <GoalsView tree={[goal]} members={[]} boards={[]} links={{}} />,
    );

    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("Ship v1")).toBeInTheDocument();
    expect(container.querySelector("svg[data-mood]")).toBeNull();
    expect(screen.queryByText("Your goals will appear here")).toBeNull();
  });
});
