import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { MapStep } from "./MapStep";
import {
  buildCommitColumns,
  deriveSheetState,
  type SheetState,
} from "./import-wizard-state";
import type { SheetPreview } from "@/lib/boards/spreadsheet/types";
import type { BoardColumnRef } from "@/lib/boards/spreadsheet/match-columns";

// Same fixture as import-wizard-state.test.ts: "Est" auto-detects as
// "numbers" (detection samples skip the subtask row), and the subtask row's
// "oops" then fails to parse under that kind — a ready-made invalid cell.
const grid = [
  ["Group", "Name", "Est"],
  ["Build", "Task A", "5"],
  ["Build", "↳ Sub", "oops"],
  ["QA", "Task B", "3"],
];

function baseSheet(g: string[][], name = "Sheet1"): SheetPreview {
  return { name, rowCount: g.length, colCount: g[0].length, grid: g };
}

function renderMapStep(overrides: {
  sheets?: SheetPreview[];
  activeSheet?: number;
  state?: SheetState;
  mode?: "new" | "existing";
  boardColumns?: BoardColumnRef[];
}) {
  const sheets = overrides.sheets ?? [baseSheet(grid)];
  const activeSheet = overrides.activeSheet ?? 0;
  const mode = overrides.mode ?? "new";
  const boardColumns = overrides.boardColumns;
  const state = overrides.state ?? deriveSheetState(grid, 0, boardColumns);
  const onSheetChange = vi.fn();
  const onStateChange = vi.fn();

  const utils = render(
    <MapStep
      sheets={sheets}
      activeSheet={activeSheet}
      onSheetChange={onSheetChange}
      state={state}
      onStateChange={onStateChange}
      mode={mode}
      boardColumns={boardColumns}
      rowCapWarning={null}
      onBack={vi.fn()}
      onNext={vi.fn()}
    />,
  );

  return { ...utils, onSheetChange, onStateChange };
}

describe("MapStep", () => {
  it("renders sheet tabs and switches", () => {
    const gridA = [["Name"], ["Alice"]];
    const gridB = [["Name"], ["Bob"]];
    const { onSheetChange } = renderMapStep({
      sheets: [baseSheet(gridA, "Sheet1"), baseSheet(gridB, "Sheet2")],
      activeSheet: 0,
      state: deriveSheetState(gridA, 0),
    });

    expect(screen.getByRole("tab", { name: "Sheet1" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sheet2" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Sheet2" }));

    expect(onSheetChange).toHaveBeenCalledWith(1);
  });

  it("re-derives state when the header row changes", () => {
    const { onStateChange } = renderMapStep({});

    const select = screen.getByLabelText("Header row");
    fireEvent.change(select, { target: { value: "2" } });

    expect(onStateChange).toHaveBeenCalledWith(deriveSheetState(grid, 2));
  });

  it("unchecking a column include dims it and updates state", () => {
    const { onStateChange, rerender } = renderMapStep({});

    const checkbox = screen.getByLabelText("Include Est") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);

    expect(onStateChange).toHaveBeenCalledTimes(1);
    const nextState = onStateChange.mock.calls[0][0] as SheetState;
    expect(nextState.columns.find((c) => c.name === "Est")?.include).toBe(
      false,
    );

    rerender(
      <MapStep
        sheets={[baseSheet(grid)]}
        activeSheet={0}
        onSheetChange={vi.fn()}
        state={nextState}
        onStateChange={onStateChange}
        mode="new"
        rowCapWarning={null}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    const header = screen.getByLabelText("Include Est").closest("th");
    expect(header).toHaveClass("opacity-50");
  });

  it("editing a column name updates state", () => {
    const { onStateChange } = renderMapStep({});

    const nameInput = screen.getByDisplayValue("Est");
    fireEvent.change(nameInput, { target: { value: "Estimate" } });

    expect(onStateChange).toHaveBeenCalledTimes(1);
    const nextState = onStateChange.mock.calls[0][0] as SheetState;
    expect(nextState.columns.find((c) => c.sourceIndex === 2)?.name).toBe(
      "Estimate",
    );
  });

  it("changing kind on a data column updates state", () => {
    const { onStateChange } = renderMapStep({});

    const kindSelect = screen.getByLabelText("Column type for Est");
    fireEvent.change(kindSelect, { target: { value: "text" } });

    expect(onStateChange).toHaveBeenCalledTimes(1);
    const nextState = onStateChange.mock.calls[0][0] as SheetState;
    expect(nextState.columns.find((c) => c.name === "Est")?.kind).toBe("text");
  });

  it("toggling a row checkbox adds its grid index to excluded", () => {
    const { onStateChange } = renderMapStep({});

    // Header is row 0, so the first rendered row ("Task A") is grid index 1.
    const rowCheckbox = screen.getByLabelText("Include row 2");
    fireEvent.click(rowCheckbox);

    expect(onStateChange).toHaveBeenCalledTimes(1);
    const nextState = onStateChange.mock.calls[0][0] as SheetState;
    expect(nextState.excluded).toContain(1);
  });

  it("renders the tooltip title on an invalid cell", () => {
    renderMapStep({});

    expect(
      screen.getByTitle("Can't parse as numbers — will import empty"),
    ).toBeInTheDocument();
  });
});

describe("MapStep existing mode", () => {
  const boardColumns: BoardColumnRef[] = [
    { id: "col-est", name: "Est", kind: "numbers", options: [] },
  ];

  it("renders a target select per data column with auto-match preselected", () => {
    renderMapStep({ mode: "existing", boardColumns });

    // "Est" auto-matches the board's "numbers" column by name+kind.
    const estTarget = screen.getByLabelText(
      "Target for Est",
    ) as HTMLSelectElement;
    expect(estTarget.value).toBe("col-est");
    expect(screen.getByRole("option", { name: "Est" })).toBeInTheDocument();

    // "Group" is demoted to a data column with no board match -> "create".
    const groupTarget = screen.getByLabelText(
      "Target for Group",
    ) as HTMLSelectElement;
    expect(groupTarget.value).toBe("create");
  });

  it('changing a target to "Skip" updates state, and buildCommitColumns reflects the skip', () => {
    const { onStateChange } = renderMapStep({ mode: "existing", boardColumns });

    const estTarget = screen.getByLabelText("Target for Est");
    fireEvent.change(estTarget, { target: { value: "skip" } });

    expect(onStateChange).toHaveBeenCalledTimes(1);
    const nextState = onStateChange.mock.calls[0][0] as SheetState;
    const estCol = nextState.columns.find((c) => c.name === "Est")!;
    expect(estCol.target).toBe("skip");

    const specs = buildCommitColumns(nextState);
    expect(specs.find((s) => s.name === "Est")?.target).toBe("skip");
  });

  it('shows a "+N new options" badge when a status column maps to a target missing option labels', () => {
    const statusGrid = [
      ["Name", "Status"],
      ["Task A", "Done"],
      ["Task B", "New"],
      ["Task C", "Done"],
    ];
    const statusBoardColumns: BoardColumnRef[] = [
      {
        id: "col-status",
        name: "Status",
        kind: "status",
        options: [{ id: "o1", label: "Done", color: "#000" }],
      },
    ];
    renderMapStep({
      sheets: [baseSheet(statusGrid)],
      mode: "existing",
      boardColumns: statusBoardColumns,
      state: deriveSheetState(statusGrid, 0, statusBoardColumns),
    });

    expect(screen.getByText("+1 new options")).toBeInTheDocument();
  });

  it("role menu offers only item-name / regular column (no group) in existing mode", () => {
    const simpleGrid = [
      ["Name", "Note"],
      ["A", "x"],
    ];
    renderMapStep({
      sheets: [baseSheet(simpleGrid)],
      mode: "existing",
      state: deriveSheetState(simpleGrid, 0),
    });

    fireEvent.click(screen.getByRole("button", { name: /Data/ }));

    expect(
      screen.getByRole("menuitem", { name: "Use as item name" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Regular column" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Use as group" }),
    ).not.toBeInTheDocument();
  });

  it("disables the kind select for a mapped target with an explanatory title", () => {
    renderMapStep({ mode: "existing", boardColumns });

    const kindSelect = screen.getByLabelText(
      "Column type for Est",
    ) as HTMLSelectElement;
    expect(kindSelect).toBeDisabled();
    expect(kindSelect).toHaveAttribute(
      "title",
      "Type comes from the board column",
    );
  });
});
