import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Column, Item } from "@/lib/boards/queries";
import { EditableCell } from "./EditableCell";
import { ItemRow } from "./ItemRow";
import { NameCell } from "./NameCell";
import { RowSelectCheckbox } from "./RowSelectCheckbox";
import { SortableSubitemRow } from "./SortableSubitemRow";
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

  it("takes an optimistic row's name cell out of the tab order", () => {
    // `open()` is a no-op while pending, so a focusable name cell is a dead
    // tab stop that announces itself as a button.
    render(<NameCell item={item(TEMP_ID)} controls={controls()} />);
    expect(screen.getByLabelText("New task name")).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("keeps a reconciled row's name cell focusable", () => {
    render(<NameCell item={item(REAL_ID)} controls={controls()} />);
    expect(screen.getByLabelText("New task name")).toHaveAttribute(
      "tabindex",
      "0",
    );
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

/** Row-level controls a whole `ItemRow` / `SortableSubitemRow` render touches. */
function rowControls(over: Partial<CellControls> = {}): CellControls {
  return controls({
    dependentsByItem: new Map<string, number>(),
    statusColumn: null,
    cache: { cellValues: [], attachments: [], timeEntries: [] },
    ...over,
  } as Partial<CellControls>);
}

const rowProps = {
  columns: [column],
  cellMap: new Map(),
  template: "1fr 1fr",
  selectable: false,
  onRenameSettled: vi.fn(),
};

describe("temp-row rule: row-level affordances", () => {
  it("disables the drag handle and the row menu on an optimistic item row", () => {
    render(
      <ItemRow
        {...rowProps}
        item={item(TEMP_ID)}
        controls={rowControls()}
        subitems={[]}
        childCount={0}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        autoFocusRename={false}
      />,
    );

    expect(screen.getByLabelText("Reorder New task")).toBeDisabled();
    expect(screen.getByLabelText("New task menu")).toBeDisabled();
  });

  it("leaves both enabled once the item row has a real id", () => {
    render(
      <ItemRow
        {...rowProps}
        item={item(REAL_ID)}
        controls={rowControls()}
        subitems={[]}
        childCount={0}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        autoFocusRename={false}
      />,
    );

    expect(screen.getByLabelText("Reorder New task")).toBeEnabled();
    expect(screen.getByLabelText("New task menu")).toBeEnabled();
  });

  it("disables the drag handle and the row menu on an optimistic subitem row", () => {
    render(
      <SortableSubitemRow
        {...rowProps}
        sub={item(TEMP_ID)}
        controls={rowControls()}
        renamingItemId={null}
      />,
    );

    expect(screen.getByLabelText("Reorder New task")).toBeDisabled();
    expect(screen.getByLabelText("New task menu")).toBeDisabled();
  });

  it("leaves both enabled once the subitem row has a real id", () => {
    render(
      <SortableSubitemRow
        {...rowProps}
        sub={item(REAL_ID)}
        controls={rowControls()}
        renamingItemId={null}
      />,
    );

    expect(screen.getByLabelText("Reorder New task")).toBeEnabled();
    expect(screen.getByLabelText("New task menu")).toBeEnabled();
  });
});
