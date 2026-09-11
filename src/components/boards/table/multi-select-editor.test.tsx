import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Column, Item } from "@/lib/boards/queries";
import { EditableCell } from "./EditableCell";
import { useEditingCell } from "./editing-store";
import type { CellControls } from "./shared";

/**
 * Multi-value cells (people, dropdown) commit once per toggle. Their popover
 * must therefore survive the commit — closing on the first pick is what made a
 * People column read as single-assignee. Single-value kinds still close.
 */
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

const itemFixture: Item = {
  id: ITEM_ID,
  org_id: "o1",
  board_id: "b1",
  group_id: "g1",
  parent_id: null,
  name: "Ship it",
  position: 1,
  created_by: "",
  created_at: "2026-09-09T00:00:00Z",
  updated_at: "2026-09-09T00:00:00Z",
  archived_at: null,
  archived_by: null,
};

function column(kind: string, settings: Record<string, unknown> = {}): Column {
  return {
    id: "c1",
    board_id: "b1",
    name: kind === "people" ? "Owner" : "Status",
    kind,
    position: 1,
    settings,
    width: null,
  } as unknown as Column;
}

function controls(over: Partial<CellControls> = {}): CellControls {
  return {
    setEditing: useEditingCell.getState().setEditing,
    setCell: vi.fn(),
    clearCellValue: vi.fn(),
    members: [
      { userId: "u1", fullName: "Ada", email: "a@x.io", avatarUrl: null },
      { userId: "u2", fullName: "Grace", email: "g@x.io", avatarUrl: null },
    ],
    renameItemInCache: vi.fn(),
    ...over,
  } as unknown as CellControls;
}

beforeEach(() => {
  act(() => useEditingCell.getState().setEditing(null));
});

function openCell(col: Column, over: Partial<CellControls> = {}) {
  const c = controls(over);
  render(
    <EditableCell item={itemFixture} column={col} value={null} controls={c} />,
  );
  act(() =>
    useEditingCell.getState().setEditing({ itemId: ITEM_ID, columnId: "c1" }),
  );
  return c;
}

describe("multi-value cell editors stay open across commits", () => {
  it("keeps the people picker open after assigning the first member", async () => {
    const setCell = vi.fn();
    openCell(column("people"), { setCell });

    await userEvent.click(screen.getByRole("option", { name: /ada/i }));

    expect(setCell).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      columnId: "c1",
      value: { userIds: ["u1"] },
    });
    expect(useEditingCell.getState().editing).toEqual({
      itemId: ITEM_ID,
      columnId: "c1",
    });
    expect(
      screen.getByRole("listbox", { name: "Assign people" }),
    ).toBeInTheDocument();
  });

  it("lets a second member be assigned without reopening the cell", async () => {
    const setCell = vi.fn();
    openCell(column("people"), { setCell });

    await userEvent.click(screen.getByRole("option", { name: /ada/i }));
    await userEvent.click(screen.getByRole("option", { name: /grace/i }));

    expect(setCell).toHaveBeenLastCalledWith({
      itemId: ITEM_ID,
      columnId: "c1",
      value: { userIds: ["u1", "u2"] },
    });
  });

  it("keeps a multi-select dropdown open after picking an option", async () => {
    const setCell = vi.fn();
    openCell(
      column("dropdown", {
        options: [
          { id: "o1", label: "Done", color: "#00c875" },
          { id: "o2", label: "Stuck", color: "#e2445c" },
        ],
      }),
      { setCell },
    );

    await userEvent.click(screen.getByRole("option", { name: /done/i }));

    expect(setCell).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      columnId: "c1",
      value: { optionIds: ["o1"] },
    });
    expect(useEditingCell.getState().editing).not.toBeNull();
  });

  it("still closes a single-value status cell on commit", async () => {
    openCell(
      column("status", {
        options: [
          { id: "o1", label: "Done", color: "#00c875" },
          { id: "o2", label: "Stuck", color: "#e2445c" },
        ],
      }),
    );

    await userEvent.click(screen.getByRole("option", { name: /done/i }));

    expect(useEditingCell.getState().editing).toBeNull();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes the people picker when the cell is cleared", async () => {
    const clearCellValue = vi.fn();
    openCell(column("people"), { clearCellValue });

    await userEvent.click(screen.getByRole("button", { name: /clear/i }));

    expect(clearCellValue).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      columnId: "c1",
    });
    expect(useEditingCell.getState().editing).toBeNull();
  });
});
