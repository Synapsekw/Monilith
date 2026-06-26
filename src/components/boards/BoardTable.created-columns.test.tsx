import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

const MEMBER_ID = "u-creator";
const CREATED_AT = "2026-06-25T15:42:00Z";

function createdColumnsPayload() {
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
      {
        id: "item-1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Top-level item",
        position: 0,
        created_by: MEMBER_ID,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      },
      {
        id: "sub-1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: "item-1",
        name: "Subitem one",
        position: 1,
        created_by: MEMBER_ID,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      },
    ],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

const MEMBERS = [
  {
    userId: MEMBER_ID,
    fullName: "Danijel Jovanovic",
    email: "danijel@example.com",
    avatarUrl: null,
  },
];

function renderCreatedColumns() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable
        payload={createdColumnsPayload()}
        members={MEMBERS}
        selectedViewId="v1"
        currentUserId={MEMBER_ID}
      />
    </QueryClientProvider>,
  );
}

describe("BoardTable created-by / created-at trailing columns", () => {
  it("renders 'Created by' and 'Created at' column headers", () => {
    renderCreatedColumns();
    // Each group renders its own header row — so at least 1 of each label
    expect(screen.getAllByText("Created by").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Created at").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the creator name for a top-level item row (resolved from members)", () => {
    renderCreatedColumns();
    // Creator name must appear at least once (for the top-level item row)
    expect(
      screen.getAllByText("Danijel Jovanovic").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows the created-at year for the item row", () => {
    renderCreatedColumns();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows the creator name for a subitem row after expanding the parent", () => {
    renderCreatedColumns();
    // Expand the parent to reveal subitems
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Top-level item" }),
    );
    // Now the subitem row should be visible and show the creator
    expect(
      screen.getAllByText("Danijel Jovanovic").length,
    ).toBeGreaterThanOrEqual(2);
  });
});
