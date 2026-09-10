import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Column, Item } from "@/lib/boards/queries";
import { EditableCell } from "./EditableCell";
import { NameCell } from "./NameCell";
import { RowSelectCheckbox } from "./RowSelectCheckbox";
import type { CellControls } from "./shared";

/**
 * The temp-row rule (stated in @/lib/boards/optimistic-id): while an
 * optimistically-added row still carries its client-minted id, nothing keyed by
 * that id may fire — no cell edit, no rename, no `?item=` open, no bulk select.
 */
const TEMP_ID = "optimistic-11111111-1111-4111-8111-111111111111";
const REAL_ID = "22222222-2222-4222-8222-222222222222";

function item(id: string): Item {
  return {
    id,
    org_id: "o1",
    board_id: "b1",
    group_id: "g1",
    parent_id: null,
    name: "New task",
    position: 1,
    created_by: "",
    created_at: "2026-09-09T00:00:00Z",
    updated_at: "2026-09-09T00:00:00Z",
    archived_at: null,
    archived_by: null,
  };
}

const column = {
  id: "c1",
  board_id: "b1",
  name: "Notes",
  kind: "text",
  position: 1,
  settings: {},
  width: null,
} as unknown as Column;

function controls(over: Partial<CellControls> = {}): CellControls {
  return {
    setEditing: vi.fn(),
    setCell: vi.fn(),
    clearCellValue: vi.fn(),
    members: [],
    renameItemInCache: vi.fn(),
    ...over,
  } as unknown as CellControls;
}

describe("temp-row read-only rule", () => {
  it("does not enter cell edit mode on an optimistic row", async () => {
    const user = userEvent.setup();
    const setEditing = vi.fn();
    render(
      <EditableCell
        item={item(TEMP_ID)}
        column={column}
        value={null}
        controls={controls({ setEditing })}
      />,
    );

    await user.click(screen.getByLabelText("New task Notes"));
    expect(setEditing).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New task Notes")).toHaveAttribute(
      "aria-disabled",
    );
  });

  it("still enters cell edit mode once the row has a real id", async () => {
    const user = userEvent.setup();
    const setEditing = vi.fn();
    render(
      <EditableCell
        item={item(REAL_ID)}
        column={column}
        value={null}
        controls={controls({ setEditing })}
      />,
    );

    await user.click(screen.getByLabelText("New task Notes"));
    expect(setEditing).toHaveBeenCalledWith({
      itemId: REAL_ID,
      columnId: "c1",
    });
  });

  it("does not open rename mode or offer the item panel on an optimistic row", async () => {
    const user = userEvent.setup();
    render(<NameCell item={item(TEMP_ID)} controls={controls()} />);

    await user.click(screen.getByLabelText("New task name"));
    expect(screen.queryByLabelText("Rename New task")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Open New task")).not.toBeInTheDocument();
  });

  it("opens rename mode once the row has a real id", async () => {
    const user = userEvent.setup();
    render(<NameCell item={item(REAL_ID)} controls={controls()} />);

    // The panel-open affordance is offered on a reconciled row (the rename
    // branch replaces the whole resting cell, so assert it before clicking).
    expect(screen.getByLabelText("Open New task")).toBeInTheDocument();
    await user.click(screen.getByLabelText("New task name"));
    expect(screen.getByLabelText("Rename New task")).toBeInTheDocument();
  });

  it("does not let an optimistic row be bulk-selected", () => {
    render(<RowSelectCheckbox itemId={TEMP_ID} name="New task" />);
    expect(screen.getByLabelText("Select New task")).toBeDisabled();
  });

  it("lets a reconciled row be bulk-selected", () => {
    render(<RowSelectCheckbox itemId={REAL_ID} name="New task" />);
    expect(screen.getByLabelText("Select New task")).toBeEnabled();
  });
});
