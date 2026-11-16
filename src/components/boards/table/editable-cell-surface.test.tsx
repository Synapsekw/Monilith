import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Column, Item } from "@/lib/boards/queries";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EditableCell } from "./EditableCell";
import { useEditingCell } from "./editing-store";
import { CELL_CENTER, CELL_START, type EditableCellControls } from "./shared";

/**
 * The item panel opens OVER the table, so one (item, column) cell is mounted
 * twice. Edit mode is keyed by surface: activating one copy must not open the
 * other's editor.
 */
const item = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Ship it",
} as unknown as Item;
const column = {
  id: "c1",
  name: "Points",
  kind: "numbers",
  settings: {},
} as unknown as Column;

const controls = {
  canEdit: true,
  setEditing: useEditingCell.getState().setEditing,
  setCell: vi.fn(),
  clearCellValue: vi.fn(),
  members: [],
  currentUserId: "u1",
  cache: {},
  workRule: { statusColumn: null, dueColumn: null, doneOptionIds: [] },
} as unknown as EditableCellControls;

function renderBoth() {
  return render(
    <TooltipProvider>
      <div data-testid="table">
        <EditableCell
          item={item}
          column={column}
          value={{ n: 5 }}
          controls={controls}
        />
      </div>
      <div data-testid="panel">
        <EditableCell
          item={item}
          column={column}
          value={{ n: 5 }}
          controls={controls}
          surface="panel"
          align="start"
        />
      </div>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  act(() => useEditingCell.getState().setEditing(null));
});

describe("EditableCell surfaces", () => {
  it("opens only the panel's editor when the panel's cell is activated", async () => {
    const user = userEvent.setup();
    renderBoth();
    const panel = screen.getByTestId("panel");
    await user.click(panel.querySelector('[role="button"]')!);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
    expect(panel.querySelector("input")).not.toBeNull();
    expect(screen.getByTestId("table").querySelector("input")).toBeNull();
  });

  it("opens only the table's editor when the table's cell is activated", async () => {
    const user = userEvent.setup();
    renderBoth();
    const table = screen.getByTestId("table");
    await user.click(table.querySelector('[role="button"]')!);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
    expect(table.querySelector("input")).not.toBeNull();
    expect(useEditingCell.getState().editing?.surface).toBeUndefined();
  });

  it("centers a table cell and start-aligns a panel cell", () => {
    renderBoth();
    const tableCell = screen
      .getByTestId("table")
      .querySelector('[role="button"]')!;
    const panelCell = screen
      .getByTestId("panel")
      .querySelector('[role="button"]')!;
    expect(tableCell.className).toContain(CELL_CENTER);
    expect(tableCell.className).not.toContain(CELL_START);
    expect(panelCell.className).toContain(CELL_START);
    expect(panelCell.className).not.toContain(CELL_CENTER);
  });
});
