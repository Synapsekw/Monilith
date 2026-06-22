import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoalStatusPill } from "@/components/goals/GoalStatusPill";

describe("GoalStatusPill", () => {
  it("shows the manual status label", () => {
    render(<GoalStatusPill status="at_risk" autoHealth="on_track" />);
    expect(screen.getByText(/at risk/i)).toBeInTheDocument();
  });
  it("shows the ·auto hint when auto-health differs from manual status", () => {
    render(<GoalStatusPill status="on_track" autoHealth="off_track" />);
    expect(screen.getByText(/auto/i)).toBeInTheDocument();
  });
  it("hides the ·auto hint when auto-health matches the manual status", () => {
    render(<GoalStatusPill status="on_track" autoHealth="on_track" />);
    expect(screen.queryByText(/auto/i)).not.toBeInTheDocument();
  });
});
