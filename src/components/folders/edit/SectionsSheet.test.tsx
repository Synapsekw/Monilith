import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { LayoutTab } from "@/lib/validations/folder-layout";
import { SectionsSheet } from "./SectionsSheet";

const tab = (id: string, kind: LayoutTab["kind"]): LayoutTab => ({
  id,
  label: id,
  kind,
});

const open = (tabs: LayoutTab[], onAddTimelineTab = vi.fn()) => {
  render(
    <SectionsSheet
      sections={[]}
      tabs={tabs}
      onAddSection={vi.fn()}
      onRenameTab={vi.fn()}
      onHideTab={vi.fn()}
      onMoveTab={vi.fn()}
      onAddTimelineTab={onAddTimelineTab}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Sections" }));
  return onAddTimelineTab;
};

describe("SectionsSheet — Add Timeline tab", () => {
  it("offers the button when no timeline tab exists and calls the handler", () => {
    const onAdd = open([tab("overview", "canvas"), tab("stages", "stages")]);
    fireEvent.click(screen.getByRole("button", { name: /Add Timeline tab/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("hides the button when a timeline tab is already present", () => {
    open([tab("overview", "canvas"), tab("timeline", "timeline")]);
    expect(
      screen.queryByRole("button", { name: /Add Timeline tab/ }),
    ).not.toBeInTheDocument();
  });

  it("hides the button at the 6-tab cap", () => {
    open([
      tab("overview", "canvas"),
      tab("a", "canvas"),
      tab("b", "canvas"),
      tab("stages", "stages"),
      tab("boards", "boards"),
      tab("people", "people"),
    ]);
    expect(
      screen.queryByRole("button", { name: /Add Timeline tab/ }),
    ).not.toBeInTheDocument();
  });
});
