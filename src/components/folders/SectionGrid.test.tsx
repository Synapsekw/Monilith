import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/folders/presets";
import { canvasSections } from "@/lib/folders/layout";
import type { LayoutSection } from "@/lib/validations/folder-layout";
import { SectionGrid } from "./SectionGrid";

/** Two full-width sections in the same column — the case that must NOT merge. */
const groupsFixture = (): LayoutSection[] => [
  {
    id: "kpis",
    type: "builtin",
    panel: "kpis",
    layout: { x: 0, y: 0, w: 12, h: 2 },
  },
  {
    id: "attention",
    type: "builtin",
    panel: "attention",
    layout: { x: 0, y: 2, w: 12, h: 5 },
  },
];

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

  it("places each grid cell on the 12-column grid from x and w", () => {
    render(
      <SectionGrid
        sections={canvasSections(PRESETS.project, "overview")}
        render={(s) => <div>{s.id}</div>}
      />,
    );
    const groups = screen.getAllByTestId("section-group");
    // burn: x 0, w 8 → column 1 span 8. boardStatus: x 8, w 4 → column 9 span 4.
    expect(groups[1].style.getPropertyValue("--col")).toBe("1 / span 8");
    expect(groups[2].style.getPropertyValue("--col")).toBe("9 / span 4");
  });

  it("stacks a consecutive same-column run into ONE grid cell", () => {
    // Regression guard for the project preset's right-hand column: rendering
    // intelligence and milestones as separate grid items lets auto-placement
    // push milestones into the row below Needs attention (measured 496px of
    // dead space). One cell, flex-column, reproduces today's 16px gap.
    render(
      <SectionGrid
        sections={canvasSections(PRESETS.project, "overview")}
        render={(s) => <div>{s.id}</div>}
      />,
    );
    const ids = screen
      .getAllByTestId("section-group")
      .map((g) =>
        Array.from(g.querySelectorAll("[data-section-id]")).map(
          (c) => (c as HTMLElement).dataset.sectionId,
        ),
      );
    expect(ids).toEqual([
      ["kpis"],
      ["burn"],
      ["board-status"],
      ["attention"],
      ["intelligence", "milestones"],
    ]);
    const right = screen.getAllByTestId("section-group")[4];
    expect(right.className).toContain("flex-col");
    expect(right.className).toContain("gap-4");
  });

  it("never stacks a full-width section with the section after it", () => {
    // kpis (x 0, w 12) and burn (x 0, w 8) share a column but must not share a
    // cell — a 12-span owns its own row.
    render(
      <SectionGrid
        sections={groupsFixture()}
        render={(s) => <div>{s.id}</div>}
      />,
    );
    const groups = screen.getAllByTestId("section-group");
    expect(groups).toHaveLength(2);
    expect(groups[0].style.getPropertyValue("--col")).toBe("1 / span 12");
    expect(groups[1].style.getPropertyValue("--col")).toBe("1 / span 12");
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
