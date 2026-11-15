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
      "load",
      "board-status",
      "people",
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
    // burn: x 0, w 8 → column 1 span 8. load: x 8, w 4 → column 9 span 4.
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
      ["load"],
      ["board-status"],
      ["people"],
      ["attention"],
      ["intelligence", "milestones"],
    ]);
    const right = screen.getAllByTestId("section-group")[6];
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

  describe("a section that renders nothing", () => {
    const tower = () => canvasSections(PRESETS.project, "overview");
    const cols = () =>
      screen
        .getAllByTestId("section-group")
        .map((g) => [
          g.getAttribute("data-section-ids"),
          g.style.getPropertyValue("--col"),
        ]);

    it("keeps the saved columns when every section renders", () => {
      render(
        <SectionGrid sections={tower()} render={(s) => <div>{s.id}</div>} />,
      );
      expect(cols()).toEqual([
        ["kpis", "1 / span 12"],
        ["burn", "1 / span 8"],
        ["load", "9 / span 4"],
        ["board-status", "1 / span 8"],
        ["people", "9 / span 4"],
        ["attention", "1 / span 8"],
        ["intelligence milestones", "9 / span 4"],
      ]);
    });

    it("lets its neighbour fill the row instead of leaving a gap", () => {
      render(
        <SectionGrid
          sections={tower()}
          render={(s) => (s.id === "load" ? null : <div>{s.id}</div>)}
        />,
      );
      const c = cols();
      expect(c).toContainEqual(["burn", "1 / span 12"]);
      expect(c.find(([id]) => id === "load")).toBeUndefined();
      expect(c).toContainEqual(["board-status", "1 / span 8"]);
      expect(screen.queryByText("load")).toBeNull();
    });

    it("widens the right-hand neighbour when the left one is absent", () => {
      render(
        <SectionGrid
          sections={tower()}
          render={(s) => (s.id === "burn" ? null : <div>{s.id}</div>)}
        />,
      );
      expect(cols()).toContainEqual(["load", "1 / span 12"]);
    });

    it("keeps a stacked cell while one of its sections still renders", () => {
      render(
        <SectionGrid
          sections={tower()}
          render={(s) => (s.id === "intelligence" ? null : <div>{s.id}</div>)}
        />,
      );
      const c = cols();
      expect(c).toContainEqual(["milestones", "9 / span 4"]);
      expect(c).toContainEqual(["attention", "1 / span 8"]);
      expect(
        document.querySelector("[data-section-id='intelligence']"),
      ).toBeNull();
    });

    it("widens attention when the whole right-hand stack is empty", () => {
      render(
        <SectionGrid
          sections={tower()}
          render={(s) =>
            s.id === "intelligence" || s.id === "milestones" ? null : (
              <div>{s.id}</div>
            )
          }
        />,
      );
      expect(cols()).toContainEqual(["attention", "1 / span 12"]);
    });
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
