import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Item } from "@/lib/boards/queries";
import { ItemRow } from "./ItemRow";
import type { CellControls } from "./shared";

const EPIC_ID = "22222222-2222-4222-8222-222222222222";
const CHILD_ID = "33333333-3333-4333-8333-333333333333";

function item(id: string, parentId: string | null, name: string): Item {
  return {
    id,
    org_id: "o1",
    board_id: "b1",
    group_id: "g1",
    parent_id: parentId,
    name,
    position: 1,
    created_by: "",
    created_at: "2026-09-09T00:00:00Z",
    updated_at: "2026-09-09T00:00:00Z",
    archived_at: null,
    archived_by: null,
  };
}

function renderRow(boardItems: Item[], selectable = true) {
  const controls = {
    setEditing: vi.fn(),
    setCell: vi.fn(),
    clearCellValue: vi.fn(),
    members: [],
    renameItemInCache: vi.fn(),
    addSubitem: vi.fn(),
    deleteItem: vi.fn(),
    dependentsByItem: new Map<string, number>(),
    statusColumn: null,
    cache: {
      items: boardItems,
      cellValues: [],
      attachments: [],
      timeEntries: [],
    },
  } as unknown as CellControls;
  return render(
    <ItemRow
      item={boardItems[0]}
      columns={[]}
      cellMap={new Map()}
      template="1fr 1fr"
      controls={controls}
      selectable={selectable}
      subitems={[]}
      childCount={0}
      isExpanded={false}
      onToggleExpand={vi.fn()}
      autoFocusRename={false}
      onRenameSettled={vi.fn()}
    />,
  );
}

describe("ItemRow gutter", () => {
  it("reserves no chevron slot when no item on the board has subitems", () => {
    const { container } = renderRow([item(EPIC_ID, null, "Epic")]);
    expect(container.querySelector("[data-chevron-slot]")).toBeNull();
  });

  it("reserves the slot on a childless row once the board has a subitem", () => {
    const { container } = renderRow([
      item(EPIC_ID, null, "Epic"),
      item(CHILD_ID, "44444444-4444-4444-8444-444444444444", "Child"),
    ]);
    expect(container.querySelector("[data-chevron-slot]")).not.toBeNull();
  });

  it("orders the gutter drag handle, then checkbox", () => {
    renderRow([item(EPIC_ID, null, "Epic")]);
    const handle = screen.getByRole("button", { name: "Reorder Epic" });
    const checkbox = screen.getByRole("checkbox", { name: "Select Epic" });
    expect(
      handle.compareDocumentPosition(checkbox) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses the 16px handle and 20px checkbox slots, keeping the 44px coarse targets", () => {
    renderRow([item(EPIC_ID, null, "Epic")]);
    const handle = screen.getByRole("button", { name: "Reorder Epic" });
    const handleClasses = handle.className.split(/\s+/);
    expect(handleClasses).toContain("w-4");
    expect(handleClasses).toContain("pointer-coarse:size-11");
    const label = screen
      .getByRole("checkbox", { name: "Select Epic" })
      .closest("label") as HTMLElement;
    const labelClasses = label.className.split(/\s+/);
    expect(labelClasses).toContain("size-5");
    expect(labelClasses).toContain("pointer-coarse:size-11");
  });

  it("omits the checkbox for viewers", () => {
    renderRow([item(EPIC_ID, null, "Epic")], false);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
