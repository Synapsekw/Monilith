import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "./BoardTable";
import { upsertCellValue, type BoardCache } from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";

/**
 * Render-budget guardrails for the board table.
 *
 * The table paints one `EditableCell` per (visible row × column) — hundreds on a
 * real board — so an interaction that re-renders "just the parent" actually
 * re-renders every visible cell. These tests pin the budget: an in-page state
 * change (entering edit mode, a horizontal scroll) must not touch cells it
 * doesn't own, and a single-cell cache patch must not reach sibling rows.
 *
 * The probe is `PresenceRing`, mocked to a plain (non-memo) component. Every
 * `EditableCell` renders exactly one, in BOTH its resting and its editing
 * branch, and it receives the cell's presence target (`cell:<item>:<column>`) —
 * so one push per render is a faithful per-cell render count that also captures
 * re-renders driven from inside the cell (store subscriptions), which a mocked
 * `EditableCell` wrapper would miss.
 */
const { cellRenders } = vi.hoisted(() => ({ cellRenders: [] as string[] }));

vi.mock("@/components/boards/presence/PresenceRing", () => ({
  PresenceRing: ({ target }: { target: string }) => {
    cellRenders.push(target);
    return null;
  },
}));

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

vi.mock("./BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const ITEM_IDS = ["i1", "i2", "i3", "i4", "i5", "i6"] as const;
const COLUMN_IDS = ["c1", "c2", "c3"] as const;

function payloadFixture() {
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
    columns: COLUMN_IDS.map((id, i) => ({
      id,
      board_id: "b1",
      org_id: "o1",
      name: `Col ${i + 1}`,
      kind: "text",
      position: i,
      width: null,
      settings: {},
    })),
    items: ITEM_IDS.map((id, i) => ({
      id,
      board_id: "b1",
      org_id: "o1",
      group_id: "g1",
      parent_id: null,
      name: `Item ${i + 1}`,
      position: i,
      created_by: null,
      created_at: "2026-06-25T15:42:00Z",
      updated_at: "2026-06-25T15:42:00Z",
    })),
    cellValues: ITEM_IDS.flatMap((itemId) =>
      COLUMN_IDS.map((columnId) => ({
        item_id: itemId,
        column_id: columnId,
        board_id: "b1",
        org_id: "o1",
        value: { text: `${itemId}-${columnId}` },
      })),
    ),
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
  const view = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <BoardTable payload={payloadFixture()} selectedViewId="v1" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

/** Distinct rows whose cells re-rendered since the last reset. */
function rowsRendered() {
  return [...new Set(cellRenders.map((t) => t.split(":")[1]))].sort();
}

beforeEach(() => {
  cellRenders.length = 0;
});

describe("BoardTable render budget", () => {
  it("paints one cell per visible row × column on mount", () => {
    renderBoard();
    // Sanity: the probe sees the whole grid, so a "0 re-renders" assertion
    // below is a real result and not an empty tree.
    expect(new Set(cellRenders).size).toBe(ITEM_IDS.length * COLUMN_IDS.length);
  });

  it("entering edit mode on one cell re-renders at most two cells", () => {
    renderBoard();
    cellRenders.length = 0;

    fireEvent.click(screen.getByRole("button", { name: "Item 1 Col 1" }));

    // The clicked cell really did enter edit mode (its editor is mounted)…
    expect(screen.getByDisplayValue("i1-c1")).toBeTruthy();
    // …and no other cell was touched. Two is the ceiling: the cell entering
    // edit mode, plus the one leaving it.
    expect(cellRenders.length).toBeLessThanOrEqual(2);
    expect(rowsRendered()).toEqual(["i1"]);
  });

  it("moving edit mode between rows re-renders only those two cells", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Item 1 Col 1" }));
    cellRenders.length = 0;

    fireEvent.click(screen.getByRole("button", { name: "Item 4 Col 2" }));

    expect(cellRenders.length).toBeLessThanOrEqual(2);
    expect(rowsRendered()).toEqual(["i1", "i4"]);
  });

  it("a single-cell cache patch does not re-render sibling rows", async () => {
    const { qc } = renderBoard();
    cellRenders.length = 0;

    await act(async () => {
      qc.setQueryData<BoardCache>(boardKey("b1"), (prev) =>
        prev
          ? upsertCellValue(prev, {
              item_id: "i1",
              column_id: "c1",
              board_id: "b1",
              org_id: "o1",
              value: { text: "patched" },
            } as never)
          : prev,
      );
      // React Query notifies observers through `notifyManager`, whose default
      // scheduler is a `setTimeout(…, 0)` — flush it so the patch is committed
      // before the render count is read.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      screen.getByRole("button", { name: "Item 1 Col 1" }).textContent,
    ).toBe("patched");
    expect(rowsRendered()).toEqual(["i1"]);
    // …and only its own cells: one per column, nothing more.
    expect(cellRenders.length).toBe(COLUMN_IDS.length);
  });

  it("a horizontal scroll re-renders no cells", () => {
    renderBoard();
    const scroller = screen.getByTestId("board-scroll");
    Object.defineProperty(scroller, "scrollLeft", {
      configurable: true,
      value: 24,
    });
    cellRenders.length = 0;

    fireEvent.scroll(scroller);

    expect(cellRenders).toEqual([]);
  });
});
