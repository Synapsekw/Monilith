import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ConfirmStep } from "@/components/boards/import/ConfirmStep";
import type { SheetState } from "@/components/boards/import/import-wizard-state";
import type { ParsedTable } from "@/lib/boards/spreadsheet/types";

const STATUS_OPTIONS = [
  { id: "o1", label: "Done", color: "#00c875" },
  { id: "o2", label: "Working", color: "#579bfc" },
];

const table: ParsedTable = {
  header: ["Name", "Status", "Estimate"],
  rows: [
    ["Task A", "Done", "5"],
    ["Task B", "BadStatus", "abc"],
  ],
  rowIndices: [1, 2],
};

const state: SheetState = {
  headerRow: 0,
  excluded: [],
  columns: [
    {
      sourceIndex: 0,
      include: true,
      name: "Name",
      kind: "text",
      options: [],
      role: "name",
      detectedKind: "text",
      target: null,
    },
    {
      sourceIndex: 1,
      include: true,
      name: "Status",
      kind: "status",
      options: STATUS_OPTIONS,
      role: "data",
      detectedKind: "status",
      target: null,
    },
    {
      sourceIndex: 2,
      include: true,
      name: "Estimate",
      kind: "numbers",
      options: [],
      role: "data",
      detectedKind: "numbers",
      target: null,
    },
  ],
  // Structure step output: one group holding both rows as top-level items.
  groups: [{ key: "grp-1", name: "Imported", existingGroupId: null }],
  structure: {
    1: { groupKey: "grp-1", type: "item" },
    2: { groupKey: "grp-1", type: "item" },
  },
};

function newDestination(boardName = "My board") {
  return {
    type: "new" as const,
    boardName,
    onBoardNameChange: vi.fn(),
  };
}

function baseProps() {
  return {
    table,
    state,
    // Full sheet == previewed slice: no truncation caveat by default.
    rowCount: 3,
    previewedRowCount: 3,
    destination: newDestination(),
    error: null,
  };
}

describe("ConfirmStep", () => {
  it("renders the summary strip with items/subitems/groups/columns/invalid counts", () => {
    render(<ConfirmStep {...baseProps()} />);

    // 2 top-level items (Task A, Task B), 0 subitems, 1 group ("Imported"),
    // 2 included data columns (Status, Estimate), 2 invalid cells (BadStatus, abc).
    expect(
      screen.getByText(
        "2 items · 0 subtasks · 1 groups · 2 columns · 2 invalid cells → empty",
      ),
    ).toBeInTheDocument();
  });

  it("shows the truncated-preview caveat when the sheet has more rows than the preview slice", () => {
    render(
      <ConfirmStep {...baseProps()} rowCount={500} previewedRowCount={200} />,
    );

    expect(
      screen.getByText(
        /These counts reflect only the first 200 previewed rows — the import itself reads the whole sheet, so all 500 rows will be imported\./,
      ),
    ).toBeInTheDocument();
  });

  it("omits the truncated-preview caveat when the preview covers the whole sheet", () => {
    render(<ConfirmStep {...baseProps()} />);

    expect(
      screen.queryByText(/These counts reflect only the first/),
    ).not.toBeInTheDocument();
  });

  it("renders a valid status cell as a pill with the option's color dot", () => {
    const { container } = render(<ConfirmStep {...baseProps()} />);

    const pillText = screen.getByText("Done");
    expect(pillText).toBeInTheDocument();

    const dot = container.querySelector('span[style*="background-color"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveStyle({ backgroundColor: "#00c875" });
  });

  it("keeps the raw text with a warning tint for an invalid cell", () => {
    render(<ConfirmStep {...baseProps()} />);

    const invalidCell = screen.getByText("BadStatus");
    expect(invalidCell).toBeInTheDocument();
    expect(invalidCell).toHaveClass("text-status-yellow");
    expect(invalidCell).toHaveAttribute(
      "title",
      "Can't parse as status — will import empty",
    );
  });

  it("shows the board-name field only in new-board mode", () => {
    const { rerender } = render(<ConfirmStep {...baseProps()} />);
    expect(screen.getByLabelText("Board name")).toBeInTheDocument();

    // Existing-board mode: grouping is handled in the Structure step, so the
    // Confirm step drops the group picker and shows no board-name field.
    rerender(
      <ConfirmStep {...baseProps()} destination={{ type: "existing" }} />,
    );
    expect(screen.queryByLabelText("Board name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Group")).not.toBeInTheDocument();
  });
});
