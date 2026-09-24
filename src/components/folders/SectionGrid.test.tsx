import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/folders/presets";
import { canvasSections } from "@/lib/folders/layout";
import { SectionGrid } from "./SectionGrid";

describe("SectionGrid", () => {
  it("renders sections in config order", () => {
    render(
      <SectionGrid
        sections={canvasSections(PRESETS.project, "overview")}
        render={(s) => <div data-testid="section">{s.id}</div>}
      />,
    );
    expect(screen.getAllByTestId("section").map((n) => n.textContent)).toEqual([
      "kpis",
      "burn",
      "board-status",
      "attention",
      "intelligence",
      "milestones",
    ]);
  });

  it("places each section on the 12-column grid from x and w", () => {
    render(
      <SectionGrid
        sections={canvasSections(PRESETS.project, "overview")}
        render={(s) => <div>{s.id}</div>}
      />,
    );
    const cells = screen.getAllByTestId("section-cell");
    // burn: x 0, w 8 → column 1 span 8. boardStatus: x 8, w 4 → column 9 span 4.
    expect(cells[1].style.getPropertyValue("--col")).toBe("1 / span 8");
    expect(cells[2].style.getPropertyValue("--col")).toBe("9 / span 4");
  });

  it("renders nothing for an empty section list", () => {
    const { container } = render(
      <SectionGrid sections={[]} render={() => null} />,
    );
    expect(
      container.querySelectorAll("[data-testid='section-cell']"),
    ).toHaveLength(0);
  });
});
