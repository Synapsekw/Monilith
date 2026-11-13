import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelGlyph } from "./panel-glyph";

function glyph(props: Parameters<typeof PanelGlyph>[0]) {
  const { container } = render(<PanelGlyph {...props} />);
  return container.querySelector("svg") as SVGSVGElement;
}

describe("PanelGlyph", () => {
  it("is decorative — the button around it carries the name", () => {
    const svg = glyph({ side: "left", open: true });
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("reports whether the panel it draws is open", () => {
    // The fill bar empties via CSS keyed on this attribute, so the glyph says
    // "this panel, folded" instead of pointing a direction.
    expect(glyph({ side: "left", open: true })).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(glyph({ side: "left", open: false })).toHaveAttribute(
      "data-state",
      "closed",
    );
  });

  it("draws the panel on the side it controls", () => {
    const left = glyph({ side: "left", open: true });
    const right = glyph({ side: "right", open: true });
    const barX = (svg: SVGSVGElement) =>
      Number(svg.querySelector("[data-panel-bar]")!.getAttribute("x"));
    expect(barX(left)).toBeLessThan(12);
    expect(barX(right)).toBeGreaterThan(12);
  });
});
