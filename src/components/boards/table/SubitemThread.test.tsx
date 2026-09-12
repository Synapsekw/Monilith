import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableSubitemRow } from "@/components/boards/table/SortableSubitemRow";
import { SUBITEM_ROW_HEIGHT } from "@/components/boards/table/shared";
import type { Item } from "@/lib/boards/queries";
import type { CellControls } from "@/components/boards/table/shared";

const sub = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Audit current copy",
  group_id: "g1",
  parent_id: "11111111-1111-4111-8111-111111111111",
  position: 1,
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
} as Item;

const controls = {
  members: [],
  deleteItem: vi.fn(),
  renameItemInCache: vi.fn(),
  dependentsByItem: new Map(),
  statusColumn: null,
  cache: { cellValues: [], attachments: [], columns: [] },
} as unknown as CellControls;

function renderSubitem() {
  return render(
    <DndContext>
      <SortableContext items={[sub.id]}>
        <SortableSubitemRow
          sub={sub}
          columns={[]}
          cellMap={new Map()}
          template="300px 1fr"
          controls={controls}
          renamingItemId={null}
          onRenameSettled={vi.fn()}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe("subitem rows — Quiet Grid", () => {
  it("renders at the subitem height", () => {
    const { container } = renderSubitem();
    const row = container.querySelector(
      "[data-intel-rule='cell']",
    ) as HTMLElement;
    expect(row.style.height).toBe(`${SUBITEM_ROW_HEIGHT}px`);
  });

  it("draws a thread line so the parent link survives without vertical rules", () => {
    renderSubitem();
    const thread = screen.getByTestId("subitem-thread");
    expect(thread).toBeInTheDocument();
    // Not just present — actually drawn: a 1px line hung at the fixed 26px
    // offset. A testid alone would pass on an invisible/zero-size span.
    expect(thread.className).toContain("bg-border");
    expect(thread.className).toContain("w-px");
    expect(thread.className).toContain("left-[26px]");
  });

  it("indents the subitem name to 40px", () => {
    renderSubitem();
    expect(screen.getByLabelText(`${sub.name} name`).className).toContain(
      "pl-10",
    );
  });
});
