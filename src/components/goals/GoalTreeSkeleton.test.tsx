import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoalTreeSkeleton } from "./GoalTreeSkeleton";

describe("GoalTreeSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<GoalTreeSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors GoalTree's full-height column scaffold", () => {
    render(<GoalTreeSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("h-full");
    expect(status.className).toContain("flex-col");
  });

  it("renders a header bar and ~8 placeholder rows", () => {
    render(<GoalTreeSkeleton />);
    expect(screen.getByTestId("skeleton-header")).toBeInTheDocument();
    expect(screen.getAllByTestId("goal-row-skeleton").length).toBe(8);
  });
});
