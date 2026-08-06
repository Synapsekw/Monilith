import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { CacheWidget } from "@/lib/dashboards/cache";
import type { WidgetRows } from "@/lib/dashboards/use-widget-rows";

const useWidgetRows = vi.fn();
vi.mock("@/lib/dashboards/use-widget-rows", () => ({
  useWidgetRows: (...a: unknown[]) => useWidgetRows(...a),
}));

import { ListWidget } from "./ListWidget";

const BOARD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const WIDGET_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const widget = {
  id: WIDGET_ID,
  kind: "list",
  title: "Tasks",
  config: {},
  source_board_id: BOARD_ID,
  dashboard_id: "dash1",
  org_id: "org1",
  layout: {},
  position: 0,
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
} as CacheWidget;

const rows: WidgetRows = {
  columns: [
    {
      id: "col-1",
      name: "Status",
      kind: "status",
      options: [{ id: "opt-1", label: "Working", color: "#8ea2eb" }],
    },
  ],
  rows: [
    {
      itemId: "item-1",
      name: "Ship it",
      cells: { "col-1": { optionId: "opt-1" } },
    },
  ],
};

describe("ListWidget colored cell", () => {
  it("renders a soft ColorChip (not an opaque inline-colored pill) for a status cell", () => {
    useWidgetRows.mockReturnValue({
      data: rows,
      isLoading: false,
      isError: false,
    });

    render(<ListWidget widget={widget} />);

    const chip = screen.getByText("Working");
    expect(chip.className).toMatch(/rounded-sm/);
    expect(chip.style.getPropertyValue("--pill")).toBe("#8ea2eb");
    // Must not be the old opaque-background pill.
    expect(chip.style.backgroundColor).toBe("");
  });
});

describe("ListWidget long text cell", () => {
  const textRows: WidgetRows = {
    columns: [{ id: "col-notes", name: "Notes", kind: "text", options: [] }],
    rows: [
      {
        itemId: "item-1",
        name: "Ship it",
        cells: {
          "col-notes": { text: "**bold** plan\n- step one\n- step two" },
        },
      },
    ],
  };

  it("truncates the value cell like the name cell, and strips Markdown syntax", () => {
    useWidgetRows.mockReturnValue({
      data: textRows,
      isLoading: false,
      isError: false,
    });

    render(<ListWidget widget={widget} />);

    const nameCell = screen.getByText("Ship it");
    const valueCell = screen.getByText("bold plan step one step two");
    expect(valueCell.textContent).not.toMatch(/[*-]/);
    expect(valueCell.closest("td")?.className).toMatch(/truncate/);
    expect(valueCell.closest("td")?.className).toBe(
      nameCell.closest("td")?.className,
    );
  });
});
