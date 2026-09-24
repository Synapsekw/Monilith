import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PRESETS } from "@/lib/folders/presets";
import { TabStrip } from "./TabStrip";

const counts = { stages: 3, boards: 2, people: 4, overloaded: 0 };

describe("TabStrip", () => {
  it("renders one tab per configured tab, in config order, with its label", () => {
    render(
      <TabStrip
        tabs={PRESETS.crm.tabs}
        tab="overview"
        counts={counts}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getAllByRole("tab").map((t) => t.textContent?.trim()),
    ).toEqual([
      "Overview",
      expect.stringContaining("Pipeline"),
      expect.stringContaining("Boards"),
    ]);
    expect(
      screen.queryByRole("tab", { name: /People/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps counts keyed by tab KIND, not by id", () => {
    render(
      <TabStrip
        tabs={PRESETS.crm.tabs}
        tab="overview"
        counts={counts}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("tab", { name: /Pipeline/ }).textContent).toContain(
      "3",
    );
  });

  it("reports the clicked tab's id", () => {
    const onChange = vi.fn();
    render(
      <TabStrip
        tabs={PRESETS.crm.tabs}
        tab="overview"
        counts={counts}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Pipeline/ }));
    expect(onChange).toHaveBeenCalledWith("stages");
  });
});
