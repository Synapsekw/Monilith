import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PRESETS } from "@/lib/folders/presets";
import type { LayoutTab } from "@/lib/validations/folder-layout";
import { TabStrip } from "./TabStrip";

const counts = { stages: 3, boards: 2, people: 4, overloaded: 0 };

// The CRM preset's renamed stages tab keeps `id: "stages"` (only its label
// changes), so it can't distinguish "keyed by kind" from "keyed by id" — a
// deliberately mismatched fixture is needed to actually prove the claim.
const idNeqKindTabs: LayoutTab[] = [
  { id: "overview", label: "Overview", kind: "canvas" },
  { id: "deal-flow", label: "Pipeline", kind: "stages" },
  { id: "b", label: "Boards", kind: "boards" },
];

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

  it("keys the count off kind even when a tab's id differs from its kind", () => {
    render(
      <TabStrip
        tabs={idNeqKindTabs}
        tab="overview"
        counts={counts}
        onChange={vi.fn()}
      />,
    );
    // "deal-flow" (id) has kind "stages" → must show the stages count, not
    // fall through to null because no tab id is literally "stages"/"boards".
    expect(screen.getByRole("tab", { name: /Pipeline/ }).textContent).toContain(
      "3",
    );
    expect(screen.getByRole("tab", { name: /Boards/ }).textContent).toContain(
      "2",
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
