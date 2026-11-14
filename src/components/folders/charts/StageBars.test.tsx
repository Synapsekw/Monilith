import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageBars } from "./StageBars";

const bars = [
  {
    key: "leads",
    name: "Leads",
    color: "#0073ea",
    total: 9,
    done: 0,
    stale: 0,
  },
  {
    key: "poc",
    name: "POC Stage",
    color: "#a25ddc",
    total: 5,
    done: 0,
    stale: 4,
  },
];

describe("StageBars", () => {
  it("draws one row per stage with its count and stale share", () => {
    render(<StageBars bars={bars} />);
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("5 · 4 stale")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "POC Stage: 5 items, 4 stale" }),
    ).toBeInTheDocument();
    const stale = screen.getAllByTestId("stage-bar-stale");
    // Widths are shares of the largest stage (9), so bars compare across rows.
    expect(stale[1]!.style.width).toBe(`${(4 / 9) * 100}%`);
  });

  it("shows an empty state with no stages", () => {
    render(<StageBars bars={[]} />);
    expect(screen.getByText("No items yet.")).toBeInTheDocument();
  });

  it("keeps widths finite when every stage is empty", () => {
    render(
      <StageBars
        bars={[
          { key: "a", name: "A", color: "#000", total: 0, done: 0, stale: 0 },
          { key: "b", name: "B", color: "#000", total: 0, done: 0, stale: 0 },
        ]}
      />,
    );
    for (const el of screen.getAllByTestId("stage-bar-stale"))
      expect(el.style.width).toBe("0%");
    expect(document.body.innerHTML).not.toContain("NaN");
  });
});
