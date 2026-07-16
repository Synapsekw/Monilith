import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as priority from "@/lib/boards/priority";
import { BoardTable } from "./BoardTable";

// jsdom offsetHeight/offsetWidth → 0 makes the virtualizer emit 0 rows; stub
// them so a viewport's worth of ItemRows actually mounts.
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

function payload(rowCount: number) {
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
    items: Array.from({ length: rowCount }, (_, i) =>
      item(`i-${i}`, `Item ${i}`),
    ),
    cellValues: [],
    dependencies: [
      {
        id: "d1",
        board_id: "b1",
        org_id: "o1",
        predecessor_id: "i-0",
        successor_id: "i-1",
        created_at: "2026-07-01T10:00:00Z",
      },
      {
        id: "d2",
        board_id: "b1",
        org_id: "o1",
        predecessor_id: "i-0",
        successor_id: "i-2",
        created_at: "2026-07-01T10:00:00Z",
      },
    ],
    views: [],
  } as never;
}

function renderBoardTableWithRows(rowCount: number) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={payload(rowCount)} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable dependents-count map hoisting", () => {
  it("computes the dependents-count map once per board render, not per row", () => {
    const spy = vi.spyOn(priority, "buildDependentsCountMap");
    renderBoardTableWithRows(30); // 30 top-level rows, several visible
    // One call in BoardTableInner — not one per visible ItemRow.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
