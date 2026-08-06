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

  it("gives the table a definite column width (table-fixed + colgroup), not just the truncate class", () => {
    // jsdom does no layout, so it can't observe whether text-overflow:ellipsis
    // actually fires — a `className` assertion alone would pass even if the
    // table used `table-layout:auto` (where `truncate`'s `white-space:nowrap`
    // makes the column grow to fit instead of clipping). Pin the structural
    // precondition ellipsis depends on: a fixed table layout with every
    // column given a definite, non-auto width via <colgroup>.
    useWidgetRows.mockReturnValue({
      data: textRows,
      isLoading: false,
      isError: false,
    });

    render(<ListWidget widget={widget} />);

    const table = screen.getByRole("table");
    expect(table.className).toMatch(/table-fixed/);
    const cols = table.querySelectorAll("colgroup col");
    // "Item" name column + 1 data column ("Notes").
    expect(cols).toHaveLength(2);
    for (const col of cols) {
      const width = (col as HTMLElement).style.width;
      expect(width).not.toBe("");
      expect(width).not.toBe("auto");
    }
  });

  it("weights the name column wider than a value column — not an equal split", () => {
    // Regression guard: equal widths (100/colCount each) squeeze the
    // usually-longest column (the item name) down to the same share as a
    // short, mostly-empty Status/Owner/Date column. The name column must get
    // a strictly larger, definite share.
    const multiColRows: WidgetRows = {
      columns: [
        { id: "col-status", name: "Status", kind: "status", options: [] },
        { id: "col-owner", name: "Owner", kind: "people", options: [] },
        { id: "col-due", name: "Due", kind: "date", options: [] },
      ],
      rows: [
        {
          itemId: "item-1",
          name: "Ship it",
          cells: {},
        },
      ],
    };
    useWidgetRows.mockReturnValue({
      data: multiColRows,
      isLoading: false,
      isError: false,
    });

    render(<ListWidget widget={widget} />);

    const cols = screen.getByRole("table").querySelectorAll("colgroup col");
    expect(cols).toHaveLength(4); // name + 3 value columns
    const widths = [...cols].map((c) =>
      parseFloat((c as HTMLElement).style.width),
    );
    const [nameWidth, ...valueWidths] = widths;
    for (const w of valueWidths) {
      expect(nameWidth).toBeGreaterThan(w);
    }
    // Every column still has a definite (non-zero, non-auto) width, and all
    // value columns split the remainder evenly.
    expect(nameWidth).toBeGreaterThan(0);
    expect(new Set(valueWidths.map((w) => w.toFixed(6))).size).toBe(1);
  });

  it("bounds the actual character count of a very long cell (not just visual clipping)", () => {
    // The DOM/tooltip payload must be bounded regardless of what CSS does —
    // `title` is a native tooltip that shows the FULL string on hover no
    // matter how the cell is visually clipped.
    const longValue = "word ".repeat(400).trim(); // ~2,000 chars
    const longRows: WidgetRows = {
      columns: [{ id: "col-notes", name: "Notes", kind: "text", options: [] }],
      rows: [
        {
          itemId: "item-1",
          name: "Ship it",
          cells: { "col-notes": { text: longValue } },
        },
      ],
    };
    useWidgetRows.mockReturnValue({
      data: longRows,
      isLoading: false,
      isError: false,
    });

    render(<ListWidget widget={widget} />);

    const valueSpan = document.querySelector(
      "tbody td:nth-child(2) span",
    ) as HTMLElement;
    expect(valueSpan).toBeTruthy();
    expect(valueSpan.textContent!.length).toBeLessThan(210);
    expect(valueSpan.textContent!.endsWith("…")).toBe(true);
    // The native `title` tooltip must be bounded too — it bypasses CSS
    // clipping entirely and shows whatever string is in the attribute.
    expect(valueSpan.getAttribute("title")!.length).toBeLessThan(210);
  });
});
