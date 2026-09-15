import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StackedStatusBar } from "./StackedStatusBar";

describe("StackedStatusBar", () => {
  it("sizes four segments by share and exposes an accessible summary", () => {
    render(
      <StackedStatusBar
        mix={{ done: 2, inProgress: 1, overdue: 1, notStarted: 0 }}
        label="Backend"
        showCount
      />,
    );
    const seg = screen.getAllByTestId("status-segment");
    expect(seg).toHaveLength(4);
    expect(seg[0]).toHaveStyle({ width: "50%" });
    expect(seg[3]).toHaveStyle({ width: "0%" });
    expect(
      screen.getByLabelText(
        "Backend: 2 done, 1 in progress, 1 overdue, 0 not started",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("renders an empty track for zero items", () => {
    render(
      <StackedStatusBar
        mix={{ done: 0, inProgress: 0, overdue: 0, notStarted: 0 }}
      />,
    );
    expect(
      screen
        .getAllByTestId("status-segment")
        .every((s) => s.style.width === "0%"),
    ).toBe(true);
  });
});
