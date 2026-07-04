import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "./BoardTable";
import { localTodayISO } from "@/lib/boards/overdue";

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

const STATUS_COL = "c-status";
const DATE_COL = "c-date";
const DONE_OPT = "opt-done";
const WORKING_OPT = "opt-working";

/** Local YYYY-MM-DD offset by `days` from today (viewer-local, like the tint). */
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
    created_at: "2026-06-25T15:42:00Z",
    updated_at: "2026-06-25T15:42:00Z",
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

function overduePayload() {
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
          options: [
            { id: WORKING_OPT, label: "Working on it", color: "#fdab3d" },
            { id: DONE_OPT, label: "Done", color: "#00c875" },
          ],
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
      item("i-overdue", "Late and not done"),
      item("i-done", "Late but done"),
      item("i-future", "Due tomorrow"),
    ],
    cellValues: [
      cell("i-overdue", STATUS_COL, { optionId: WORKING_OPT }),
      cell("i-overdue", DATE_COL, { date: localISO(-1) }),
      cell("i-done", STATUS_COL, { optionId: DONE_OPT }),
      cell("i-done", DATE_COL, { date: localISO(-1) }),
      cell("i-future", STATUS_COL, { optionId: WORKING_OPT }),
      cell("i-future", DATE_COL, { date: localISO(1) }),
    ],
    dependencies: [],
    views: [],
  } as never;
}

function renderBoard() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={overduePayload()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable overdue date tint", () => {
  it("tints only the past-due date cell of the incomplete item", () => {
    renderBoard();
    // Exactly one Overdue cell: the done item's past date and the future date
    // must render untinted.
    const tinted = screen.getAllByLabelText("Overdue");
    expect(tinted).toHaveLength(1);
    expect(tinted[0].className).toContain("text-destructive");
    expect(tinted[0].className).toContain("bg-destructive/10");
    // It lives in the overdue item's date cell (accessible cell name is
    // "<item name> <column name>").
    expect(
      screen
        .getByRole("button", { name: "Late and not done Due date" })
        .querySelector('[aria-label="Overdue"]'),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Late but done Due date" })
        .querySelector('[aria-label="Overdue"]'),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Due tomorrow Due date" })
        .querySelector('[aria-label="Overdue"]'),
    ).toBeNull();
  });
});
