import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ItemQuickEdit, type QuickEditTarget } from "./ItemQuickEdit";
import type { CacheColumn } from "@/lib/boards/cache";

const target: QuickEditTarget = {
  itemId: "i1",
  anchorRect: new DOMRect(100, 100, 80, 18),
};
const statusColumn = {
  id: "c-status",
  kind: "status",
  name: "Status",
  settings: {
    options: [
      { id: "o1", label: "Done", color: "#00854d" },
      { id: "o2", label: "Stuck", color: "#d83a52" },
    ],
  },
} as unknown as CacheColumn;
const percentColumn = {
  id: "c-pct",
  kind: "percent",
  name: "% complete",
  settings: {},
} as unknown as CacheColumn;

function setup(overrides: Partial<Parameters<typeof ItemQuickEdit>[0]> = {}) {
  const props = {
    target,
    itemName: "Design homepage",
    statusColumn,
    percentColumn,
    statusValue: { optionId: "o1" },
    percentValue: { percent: 40 },
    setCell: vi.fn(),
    clearCellValue: vi.fn(),
    onOpenItem: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ItemQuickEdit {...props} />);
  return props;
}

describe("ItemQuickEdit", () => {
  it("renders the item name, status pills, and percent input from the cache values", () => {
    setup();
    expect(
      screen.getByRole("dialog", { name: "Edit Design homepage" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Done" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("% complete")).toHaveValue(40);
  });

  it("commits a status pick through setCell and stays open", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("option", { name: "Stuck" }));
    expect(p.setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "c-status",
      value: { optionId: "o2" },
    });
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it("routes status Clear through clearCellValue", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(p.clearCellValue).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "c-status",
    });
  });

  it("commits a clamped percent on Enter and a clear when emptied", () => {
    const p = setup();
    const input = screen.getByLabelText("% complete");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "c-pct",
      value: { percent: 100 },
    });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(p.clearCellValue).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: "c-pct",
    });
  });

  it("hides absent sections and never autofocuses", () => {
    setup({ percentColumn: null, percentValue: null });
    expect(screen.queryByLabelText("% complete")).not.toBeInTheDocument();
    expect(document.activeElement?.tagName).not.toBe("INPUT");
  });

  it("hides the status section when only percent is editable", () => {
    setup({ statusColumn: null, statusValue: null });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByLabelText("% complete")).toBeInTheDocument();
  });

  it("Open hands off to the item panel and closes", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(p.onOpenItem).toHaveBeenCalledWith("i1");
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when dismissed with Escape", () => {
    const p = setup();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it("carries 44px coarse-pointer targets", () => {
    setup();
    expect(screen.getByLabelText("% complete").className).toContain(
      "pointer-coarse:min-h-11",
    );
    expect(screen.getByRole("button", { name: /open/i }).className).toContain(
      "pointer-coarse:min-h-11",
    );
  });
});
