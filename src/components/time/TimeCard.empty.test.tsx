import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimeCard } from "./TimeCard";
import type { TimeCardData } from "@/lib/time/types";

vi.mock("@/lib/time/actions", () => ({
  upsertTimeAllocation: vi.fn(),
  deleteTimeAllocation: vi.fn(),
  searchAllocatableItems: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const DAYS = ["2026-06-29", "2026-06-30", "2026-07-01"];
const EMPTY: TimeCardData = {
  weekStart: DAYS[0],
  userId: "user-1",
  days: DAYS,
  rows: [],
};
const ONE_ROW: TimeCardData = {
  ...EMPTY,
  rows: [
    {
      key: "cat:Design",
      kind: "category",
      itemId: null,
      boardId: null,
      boardName: null,
      category: "Design",
      label: "Design",
      cells: DAYS.map((day) => ({ day, manualSecs: 0, timerSecs: 0 })),
      totalSecs: 0,
    },
  ],
};

describe("TimeCard empty week", () => {
  it("shows Mono, what will appear, and the existing Add row picker", () => {
    const { container } = render(<TimeCard data={EMPTY} categories={[]} />);

    expect(container.querySelector("svg[data-mood]")).not.toBeNull();
    expect(
      screen.getByText("Your time for this week will appear here"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add a row to log hours against a task or category."),
    ).toBeInTheDocument();
    // The header's picker plus the same picker in the empty state.
    expect(screen.getAllByRole("button", { name: "Add row" })).toHaveLength(2);
    // The mascot is not inside a table: there is no table to be inside.
    expect(container.querySelector("table")).toBeNull();
    expect(screen.queryByText(/No rows yet/)).toBeNull();
    // The header (week navigation) is untouched.
    expect(
      screen.getByRole("button", { name: "Previous week" }),
    ).toBeInTheDocument();
  });

  it("shows the grid, and no mascot, once there is a row", () => {
    const { container } = render(<TimeCard data={ONE_ROW} categories={[]} />);

    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("svg[data-mood]")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Add row" })).toHaveLength(1);
  });
});
