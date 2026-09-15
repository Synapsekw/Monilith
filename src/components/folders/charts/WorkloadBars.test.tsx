import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkloadBars } from "./WorkloadBars";

describe("WorkloadBars", () => {
  it("scales bars to the max, flags people over the threshold in red and shows late counts", () => {
    render(
      <WorkloadBars
        people={[
          { userId: "u1", name: "Ada", avatarUrl: null, open: 20, overdue: 3 },
          {
            userId: "u2",
            name: "Grace",
            avatarUrl: null,
            open: 10,
            overdue: 0,
          },
        ]}
      />,
    );
    const bars = screen.getAllByTestId("workload-bar");
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "50%" });
    expect(bars[0]).toHaveAttribute("data-overloaded", "true");
    expect(bars[1]).toHaveAttribute("data-overloaded", "false");
    expect(screen.getByText("3 late")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });
  it("renders the empty state without people", () => {
    render(<WorkloadBars people={[]} />);
    expect(
      screen.getByText("No open items are assigned in this stage."),
    ).toBeInTheDocument();
  });
});
