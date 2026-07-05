import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StructureStep } from "./StructureStep";
import { deriveSheetState, seedStructure } from "./import-wizard-state";
import type { ParsedTable } from "@/lib/boards/spreadsheet/types";

const grid = [["Name"], ["Alpha"], ["Beta"]];
const table: ParsedTable = {
  header: ["Name"],
  rows: [["Alpha"], ["Beta"]],
  rowIndices: [1, 2],
};

function setup() {
  const seeded = seedStructure(deriveSheetState(grid, 0), table, "new", []);
  return seeded;
}

describe("StructureStep", () => {
  it("renders one row per included row with a Type and Group control", () => {
    const state = setup();
    render(
      <StructureStep
        table={table}
        state={state}
        mode="new"
        existingGroups={[]}
        onStateChange={() => {}}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/type for/i)).toHaveLength(2);
  });

  it("adding a group makes it selectable", () => {
    const state = setup();
    let next = state;
    render(
      <StructureStep
        table={table}
        state={state}
        mode="new"
        existingGroups={[]}
        onStateChange={(s) => (next = s)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add group/i }));
    expect(next.groups).toHaveLength(2);
  });
});
