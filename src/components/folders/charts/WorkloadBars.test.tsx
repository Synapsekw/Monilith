import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STATUS_BG } from "@/components/ui/status-pill";
import { WorkloadBars } from "./WorkloadBars";

const ada = {
  userId: "u1",
  name: "Ada",
  avatarUrl: null,
  open: 20,
  overdue: 5,
};
const grace = {
  userId: "u2",
  name: "Grace",
  avatarUrl: null,
  open: 10,
  overdue: 0,
};

describe("WorkloadBars", () => {
  it("scales bar length to the person with the most open items", () => {
    render(
      <WorkloadBars
        people={[
          { ...ada, open: 8, overdue: 0 },
          { ...grace, open: 4 },
        ]}
      />,
    );
    // Below the overload threshold too: the largest person is the full bar.
    const bars = screen.getAllByTestId("workload-bar");
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "50%" });
  });

  it("draws the late share as a red segment inside a brand-coloured bar", () => {
    render(<WorkloadBars people={[ada, grace]} />);
    const [adaBar, graceBar] = screen.getAllByTestId("workload-bar");
    expect(adaBar).toHaveStyle({ width: "100%" });
    expect(adaBar).toHaveClass("bg-primary");
    expect(adaBar).not.toHaveClass(STATUS_BG.red);
    const late = screen.getAllByTestId("workload-late");
    expect(late).toHaveLength(1);
    expect(late[0]).toHaveStyle({ width: "25%" }); // 5 of 20
    expect(late[0]).toHaveClass(STATUS_BG.red);
    expect(adaBar).toContainElement(late[0]!);
    expect(graceBar).toHaveStyle({ width: "50%" });
    expect(screen.getByText("5 late")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("flags overload in words, not by turning the whole bar red", () => {
    render(<WorkloadBars people={[ada, grace]} threshold={15} />);
    const [adaBar, graceBar] = screen.getAllByTestId("workload-bar");
    expect(adaBar).toHaveAttribute("data-overloaded", "true");
    expect(graceBar).toHaveAttribute("data-overloaded", "false");
    expect(adaBar).toHaveClass("bg-primary");
    expect(screen.getAllByText("over 15")).toHaveLength(1);
  });

  it("reserves the late and overload columns only when someone needs them", () => {
    const { container, unmount } = render(
      <WorkloadBars people={[{ ...ada, open: 8, overdue: 0 }, grace]} />,
    );
    expect(container.querySelectorAll("[data-col='late']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-col='over']")).toHaveLength(0);
    unmount();
    // Ada is late (and over 15): both columns exist on every row, so the
    // figures line up; Grace gets empty cells.
    const { container: c2 } = render(<WorkloadBars people={[ada, grace]} />);
    expect(c2.querySelectorAll("[data-col='late']")).toHaveLength(2);
    expect(c2.querySelectorAll("[data-col='over']")).toHaveLength(2);
  });

  it("renders the empty state without people", () => {
    render(<WorkloadBars people={[]} />);
    expect(screen.getByText("No open items are assigned.")).toBeInTheDocument();
  });

  it("names the stage scope only while a stage filter is active", () => {
    render(<WorkloadBars people={[]} stage="build" />);
    expect(
      screen.getByText("No open items are assigned in this stage."),
    ).toBeInTheDocument();
  });
});
