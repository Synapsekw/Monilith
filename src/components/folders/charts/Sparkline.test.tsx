import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("draws a line with an emphasised end point and a text alternative", () => {
    const { container } = render(
      <Sparkline
        points={[1, 3, 2, 6]}
        color="red"
        label="Overdue, last 4 weeks: 1, 3, 2, 6"
      />,
    );
    expect(
      screen.getByRole("img", { name: /Overdue, last 4 weeks/ }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("draws one bar per point in bars mode", () => {
    const { container } = render(
      <Sparkline
        kind="bars"
        points={[3, 5, 1]}
        color="blue"
        label="Due per week"
      />,
    );
    expect(container.querySelectorAll("rect")).toHaveLength(3);
  });

  it("renders nothing for fewer than two points and survives a flat series", () => {
    const { container, rerender } = render(
      <Sparkline points={[4]} color="green" label="x" />,
    );
    expect(container.firstChild).toBeNull();
    rerender(<Sparkline points={[4, 4, 4]} color="green" label="x" />);
    expect(
      container.querySelector("polyline")?.getAttribute("points"),
    ).not.toContain("NaN");
  });
});
