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
});
