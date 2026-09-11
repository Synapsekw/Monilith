import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "./BoardTable";
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
} from "@/lib/boards/intelligence/context";
import { localTodayISO } from "@/lib/boards/overdue";
import type { BoardPayload } from "@/lib/boards/queries";

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
// The chip lives in the URL; the provider + table read it through useSearchParams.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const STATUS_COL = "c-status";
const DATE_COL = "c-date";
const WORKING = "opt-working";

function localISO(daysFromToday: number) {
  return localTodayISO(new Date(Date.now() + daysFromToday * 86_400_000));
}
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
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}
function cell(itemId: string, columnId: string, value: unknown) {
  return {
    item_id: itemId,
    column_id: columnId,
    value,
    updated_at: "2026-09-01T00:00:00Z",
  };
}
function payload() {
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
        id: STATUS_COL,
        board_id: "b1",
        org_id: "o1",
        name: "Status",
        kind: "status",
        position: 0,
        width: null,
        settings: {
          options: [{ id: WORKING, label: "Working on it", color: "#fdab3d" }],
        },
      },
      {
        id: DATE_COL,
        board_id: "b1",
        org_id: "o1",
        name: "Due date",
        kind: "date",
        position: 1,
        width: null,
        settings: {},
      },
    ],
    items: [
      item("i-late", "Late and not done"),
      item("i-future", "Due tomorrow"),
    ],
    cellValues: [
      cell("i-late", STATUS_COL, { optionId: WORKING }),
      cell("i-late", DATE_COL, { date: localISO(-1) }),
      cell("i-future", STATUS_COL, { optionId: WORKING }),
      cell("i-future", DATE_COL, { date: localISO(1) }),
    ],
    dependencies: [],
    views: [],
  } as unknown as BoardPayload;
}

function renderBoard() {
  const qc = new QueryClient();
  const p = payload();
  return render(
    <QueryClientProvider client={qc}>
      <BoardIntelligenceProvider
        boardId="b1"
        initialData={p}
        members={[]}
        lastSeenAt={null}
        currentUserId="u1"
      >
        <IntelToneFrame>
          <BoardTable payload={p} selectedViewId="v1" />
        </IntelToneFrame>
      </BoardIntelligenceProvider>
    </QueryClientProvider>,
  );
}

describe("BoardTable with an active intelligence chip", () => {
  it("shows both rows with no highlight when no chip is active", () => {
    window.history.replaceState(null, "", "/boards/b1");
    renderBoard();
    expect(screen.getByText("Late and not done")).toBeInTheDocument();
    expect(screen.getByText("Due tomorrow")).toBeInTheDocument();
    expect(document.querySelector(".intel-match")).toBeNull();
    expect(document.querySelector(".intel-miss")).toBeNull();
  });

  it("intel=overdue narrows to the overdue row and paints the red rule on it", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=overdue");
    renderBoard();
    expect(screen.getByText("Late and not done")).toBeInTheDocument();
    expect(screen.queryByText("Due tomorrow")).not.toBeInTheDocument();
    const row = screen.getByText("Late and not done").closest(".intel-match");
    expect(row).not.toBeNull();
    expect(row!.closest("[data-intel-tone]")).toHaveAttribute(
      "data-intel-tone",
      "red",
    );
  });
});
