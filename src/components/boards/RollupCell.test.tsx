import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RollupCell } from "./RollupCell";

describe("RollupCell", () => {
  it("renders a number sum", () => {
    render(<RollupCell result={{ kind: "number", total: 21 }} />);
    expect(screen.getByText(/Σ\s*21/)).toBeInTheDocument();
  });

  it("renders a people count", () => {
    render(<RollupCell result={{ kind: "people", count: 1 }} />);
    expect(screen.getByText("1 person")).toBeInTheDocument();
  });

  it("renders a distribution bar with an aria summary", () => {
    render(
      <RollupCell
        result={{
          kind: "distribution",
          total: 3,
          segments: [{ id: "d", label: "Done", color: "#0f0", count: 2 }],
        }}
      />,
    );
    expect(screen.getByRole("img", { name: /Done: 2/ })).toBeInTheDocument();
  });

  it("renders a percent average as a progressbar with a label", () => {
    render(<RollupCell result={{ kind: "percent", average: 75 }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("renders nothing meaningful when blank", () => {
    const { container } = render(<RollupCell result={{ kind: "blank" }} />);
    expect(container.textContent).toBe("");
  });

  it("renders a checkbox checked/total summary", () => {
    render(<RollupCell result={{ kind: "checkbox", checked: 2, total: 5 }} />);
    expect(screen.getByText(/2\/5/)).toBeInTheDocument();
  });

  it("renders a rating average", () => {
    render(<RollupCell result={{ kind: "rating", average: 3.5 }} />);
    expect(screen.getByText(/3\.5/)).toBeInTheDocument();
  });
});
