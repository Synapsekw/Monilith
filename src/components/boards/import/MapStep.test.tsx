import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { MapStep } from "./MapStep";
import { deriveSheetState, type SheetState } from "./import-wizard-state";
import type { SheetPreview } from "@/lib/boards/spreadsheet/types";

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
}) {
  const sheets = overrides.sheets ?? [baseSheet(grid)];
  const activeSheet = overrides.activeSheet ?? 0;
  const state = overrides.state ?? deriveSheetState(grid, 0);
  const onSheetChange = vi.fn();
  const onStateChange = vi.fn();

  const utils = render(
    <MapStep
      sheets={sheets}
      activeSheet={activeSheet}
      onSheetChange={onSheetChange}
      state={state}
      onStateChange={onStateChange}
      mode="new"
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
