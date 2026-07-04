import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "./BoardTable";

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
    .mockResolvedValue({ ok: true, data: { urls: {} } }),
}));

vi.mock("./BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));

// BoardTable reads filter/sort/search state from the URL (useSearchParams).
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const PRIORITY_COL = "c-priority";

function item(id: string, name: string) {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    group_id: "g1",
    parent_id: null,
    name,
    position: 0,
    created_by: null,
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T10:00:00Z",
  };
}

function cell(itemId: string, columnId: string, value: unknown) {
  return {
    item_id: itemId,
    column_id: columnId,
    board_id: "b1",
    org_id: "o1",
    value,
  };
}

function dependency(id: string, predecessorId: string, successorId: string) {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    predecessor_id: predecessorId,
    successor_id: successorId,
    created_at: "2026-07-01T10:00:00Z",
  };
}

/**
 * Items A–D with a priority column. B→A and C→A give A two direct dependents
 * (auto-critical); D carries a stored manual critical with zero dependents.
 */
function priorityPayload() {
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
    columns: [
      {
        id: PRIORITY_COL,
        board_id: "b1",
        org_id: "o1",
        name: "Priority",
        kind: "priority",
        position: 0,
        width: null,
        settings: {},
      },
    ],
    items: [
      item("i-a", "Item A"),
      item("i-b", "Item B"),
      item("i-c", "Item C"),
      item("i-d", "Item D"),
    ],
    cellValues: [cell("i-d", PRIORITY_COL, { level: "critical" })],
    dependencies: [
      dependency("d1", "i-a", "i-b"),
      dependency("d2", "i-a", "i-c"),
    ],
    views: [],
  } as never;
}

function renderBoard() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={priorityPayload()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable priority dependents threading", () => {
  it("auto-flags an item with 2+ dependents in its priority cell", () => {
    renderBoard();
    const auto = screen.getByLabelText(
      "Critical (auto) — 2 items depend on this",
    );
    expect(auto).toBeInTheDocument();
    // The auto pill lives in Item A's priority cell.
    expect(
      screen
        .getByRole("button", { name: "Item A Priority" })
        .querySelector('[title="Critical (auto) — 2 items depend on this"]'),
    ).not.toBeNull();
  });

  it("shows a plain critical pill for a manual value without dependents", () => {
    renderBoard();
    // D's pill: plain "Critical" title, no auto explanation.
    expect(
      screen
        .getByRole("button", { name: "Item D Priority" })
        .querySelector('[title="Critical"]'),
    ).not.toBeNull();
  });

  it("leaves items below the threshold blank", () => {
    renderBoard();
    const bCell = screen.getByRole("button", { name: "Item B Priority" });
    expect(bCell.textContent).not.toContain("Critical");
    expect(bCell.textContent).not.toContain("Normal");
  });
});
