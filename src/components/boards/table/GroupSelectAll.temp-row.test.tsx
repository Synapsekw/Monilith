import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "@/components/boards/BoardTable";
import { useBoardSelection } from "@/stores/board-selection";

/**
 * Temp-row rule (see @/lib/boards/optimistic-id) at the group level: the
 * selection store refuses optimistic ids, so a "select all visible" list that
 * still contained one could never reach `selectedCount === visibleIds.length`
 * — the header checkbox would latch unchecked and its second click would
 * re-select instead of clearing.
 */
const TEMP_ID = "optimistic-11111111-1111-4111-8111-111111111111";

// jsdom offsetHeight/offsetWidth → 0 makes the virtualizer emit 0 rows; stub them.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 1200;
    },
  });
});

vi.mock("@/lib/boards/actions", () => ({
  createGroup: vi.fn(),
  updateGroupColor: vi.fn(),
  deleteGroup: vi.fn(),
  archiveGroup: vi.fn(),
  archiveItem: vi.fn(),
  addSubitem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItem: vi.fn(),
  updateColumnSettings: vi.fn(),
}));

vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: vi.fn(),
  deleteDependency: vi.fn(),
}));

vi.mock("@/lib/collaboration/actions", () => ({
  createAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  getAttachmentPreviewUrls: vi
    .fn()
    .mockResolvedValue({ ok: true, data: { urls: {}, thumbUrls: {} } }),
}));

vi.mock("@/components/boards/BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

function item(id: string, name: string, position: number) {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    group_id: "g1",
    parent_id: null,
    name,
    position,
    created_by: null,
    created_at: "2026-09-09T00:00:00Z",
    updated_at: "2026-09-09T00:00:00Z",
  };
}

function payloadWithTempRow() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board", name_column_width: null },
    groups: [
      {
        id: "g1",
        board_id: "b1",
        org_id: "o1",
        name: "Group 1",
        color: "#0073ea",
        position: 0,
      },
    ],
    columns: [],
    items: [
      item("i1", "Real one", 0),
      item("i2", "Real two", 1),
      item(TEMP_ID, "Just added", 2),
    ],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
    views: [],
  } as never;
}

function renderBoard() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={payloadWithTempRow()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useBoardSelection.getState().clear();
});

describe("group select-all with an optimistic row visible", () => {
  it("checks once every selectable row is selected, and unchecks on a second click", () => {
    renderBoard();
    const selectAll = screen.getByLabelText<HTMLInputElement>(
      "Select all visible items in this group",
    );
    expect(selectAll.checked).toBe(false);

    fireEvent.click(selectAll);

    // The temp row is not selectable, so "all" means all the REAL rows.
    expect([...useBoardSelection.getState().selectedIds].sort()).toEqual([
      "i1",
      "i2",
    ]);
    expect(selectAll.checked).toBe(true);

    fireEvent.click(selectAll);

    expect([...useBoardSelection.getState().selectedIds]).toEqual([]);
    expect(selectAll.checked).toBe(false);
  });

  it("hides the select-all when every visible row is still optimistic", () => {
    const qc = new QueryClient();
    const payload = payloadWithTempRow() as unknown as {
      items: ReturnType<typeof item>[];
    };
    payload.items = [item(TEMP_ID, "Just added", 0)];
    render(
      <QueryClientProvider client={qc}>
        <BoardTable payload={payload as never} selectedViewId="v1" />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByLabelText("Select all visible items in this group"),
    ).toBeNull();
  });
});
