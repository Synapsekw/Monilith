import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Kicker } from "./kicker";

describe("Kicker", () => {
  it("uppercases the label via class and renders children", () => {
    render(<Kicker>Updates</Kicker>);
    const el = screen.getByText("Updates");
    expect(el).toHaveClass("uppercase");
    expect(el.className).toContain("font-mono");
  });

  it("renders an accent index prefix with a separator when index is given", () => {
    render(<Kicker index="01">Sprint 24</Kicker>);
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("Sprint 24")).toBeInTheDocument();
    // separator " / " present in the accessible text
    expect(screen.getByText("01").parentElement).toHaveTextContent(
      "01 / Sprint 24",
    );
  });

  it("merges a custom className", () => {
    render(<Kicker className="mb-2">Files</Kicker>);
    expect(screen.getByText("Files")).toHaveClass("mb-2");
  });
});
