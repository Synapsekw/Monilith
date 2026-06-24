import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CapacityCell } from "@/components/workload/CapacityCell";

describe("CapacityCell", () => {
  it("shows the effort / capacity readout in hours", () => {
    render(
      <CapacityCell
        effortSecs={18 * 3600}
        capacitySecs={40 * 3600}
        state="under"
      />,
    );
    expect(screen.getByText(/18h/)).toBeInTheDocument();
    expect(screen.getByText(/40h/)).toBeInTheDocument();
  });
  it("renders an over-capacity cell distinctly", () => {
    render(
      <CapacityCell
        effortSecs={50 * 3600}
        capacitySecs={40 * 3600}
        state="over"
      />,
    );
    expect(screen.getByText(/50h/)).toBeInTheDocument();
    expect(screen.getByTestId("capacity-cell")).toHaveAttribute(
      "data-state",
      "over",
    );
  });
  it("renders the unassigned/none state without a capacity denominator", () => {
    render(
      <CapacityCell effortSecs={4 * 3600} capacitySecs={0} state="none" />,
    );
    expect(screen.getByText(/4h/)).toBeInTheDocument();
    expect(screen.getByTestId("capacity-cell")).toHaveAttribute(
      "data-state",
      "none",
    );
  });

  it("variance metric shows the signed delta, pct, and an over state", () => {
    render(
      <CapacityCell
        effortSecs={6 * 3600}
        capacitySecs={8 * 3600}
        actualSecs={9 * 3600}
        state="under"
        metric="variance"
      />,
    );
    const cell = screen.getByTestId("capacity-cell");
    expect(cell).toHaveAttribute("data-state", "over"); // logged 9h vs planned 6h
    expect(cell).toHaveTextContent("+3h");
    expect(cell).toHaveTextContent("+50%");
  });

  it("renders a capacity bar element for a planned cell with capacity", () => {
    render(
      <CapacityCell
        effortSecs={20 * 3600}
        capacitySecs={40 * 3600}
        state="under"
        metric="planned"
      />,
    );
    // the bar is a presentational element marked with a stable test id
    expect(screen.getByTestId("capacity-bar")).toBeInTheDocument();
  });

  it("omits the capacity bar when there is no capacity (none state)", () => {
    render(
      <CapacityCell
        effortSecs={0}
        capacitySecs={0}
        state="none"
        metric="planned"
      />,
    );
    expect(screen.queryByTestId("capacity-bar")).not.toBeInTheDocument();
  });

  it("variance metric renders an em dash for pct when there is no plan", () => {
    render(
      <CapacityCell
        effortSecs={0}
        capacitySecs={8 * 3600}
        actualSecs={4 * 3600}
        state="none"
        metric="variance"
      />,
    );
    const cell = screen.getByTestId("capacity-cell");
    expect(cell).toHaveAttribute("data-state", "over");
    expect(cell).toHaveTextContent("+4h");
    expect(cell).toHaveTextContent("—");
  });
});
