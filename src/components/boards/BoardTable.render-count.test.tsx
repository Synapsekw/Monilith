import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "./BoardTable";
import { BoardIntelligenceProvider } from "@/lib/boards/intelligence/context";
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
const { cellRenders, rowBodyRenders } = vi.hoisted(() => ({
  cellRenders: [] as string[],
  rowBodyRenders: [] as string[],
}));

vi.mock("@/components/boards/presence/PresenceRing", () => ({
  PresenceRing: ({ target }: { target: string }) => {
    cellRenders.push(target);
    return null;
  },
}));

/**
 * Row-BODY probe. `RowMenu` is a plain (non-memo) component rendered exactly
 * once per `ItemRow` / `SortableSubitemRow`, so one push == one row-body
 * re-render. The cell probe above can't see this: a row body can re-render
 * (dnd-kit `useSortable` reading a fresh `SortableContext` value) while every
 * memoized `EditableCell` under it bails out — which is precisely how the
 * unstable `SortableContext` `items` array hid.
 */
vi.mock("./table/RowMenu", () => ({
  RowMenu: ({ label }: { label: string }) => {
    rowBodyRenders.push(label);
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

// Reads the LIVE window.location so the intelligence budget below can switch
// a chip on with `history.replaceState` — exactly how the real hook sees it.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const ITEM_IDS = ["i1", "i2", "i3", "i4", "i5", "i6"] as const;
const COLUMN_IDS = ["c1", "c2", "c3"] as const;

/** `subitemOf`: attach one subitem to that parent (exercises `SubitemBlock`). */
function payloadFixture(opts: { subitemOf?: string } = {}) {
  const subitem = opts.subitemOf
    ? {
        id: "s1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: opts.subitemOf,
        name: "Sub 1",
        position: 0,
        created_by: null,
        created_at: "2026-06-25T15:42:00Z",
        updated_at: "2026-06-25T15:42:00Z",
      }
    : null;
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
    items: [
      ...ITEM_IDS.map((id, i) => ({
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
      ...(subitem ? [subitem] : []),
    ],
    cellValues: [...ITEM_IDS, ...(subitem ? ["s1"] : [])].flatMap((itemId) =>
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

function renderBoard(opts: { subitemOf?: string } = {}) {
  const qc = new QueryClient();
  const view = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <BoardTable payload={payloadFixture(opts)} selectedViewId="v1" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

/** Distinct rows whose cells re-rendered since the last reset. */
function rowsRendered() {
  return [...new Set(cellRenders.map((t) => t.split(":")[1]))].sort();
}

/** Distinct row bodies that re-rendered since the last reset. */
function rowBodiesRendered() {
  return [...new Set(rowBodyRenders)].sort();
}

function resetProbes() {
  cellRenders.length = 0;
  rowBodyRenders.length = 0;
}

beforeEach(resetProbes);

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

/**
 * Row-BODY budget. dnd-kit puts `items` in the `SortableContext` memo deps, so
 * a per-render id array re-renders EVERY `useSortable` row body on the board —
 * invisible to the cell probe, because the memoized cells under those bodies
 * still bail out. These pin the id arrays as referentially stable across
 * content-equal recomputes (top-level rows AND `SubitemBlock`'s subitems).
 */
describe("BoardTable row-body render budget", () => {
  async function patchCell(
    qc: QueryClient,
    itemId: string,
    columnId: string,
    text: string,
  ) {
    await act(async () => {
      qc.setQueryData<BoardCache>(boardKey("b1"), (prev) =>
        prev
          ? upsertCellValue(prev, {
              item_id: itemId,
              column_id: columnId,
              value: { text },
              updated_at: "2026-06-25T15:43:00Z",
            } as never)
          : prev,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** 6 top-level rows + one subitem under Item 6, expanded so it is mounted. */
  function renderExpandedBoard() {
    const view = renderBoard({ subitemOf: "i6" });
    fireEvent.click(screen.getByRole("button", { name: "Expand Item 6" }));
    expect(rowBodiesRendered()).toContain("Sub 1");
    resetProbes();
    return view;
  }

  it("a single-cell patch re-renders only the patched row's body", async () => {
    const { qc } = renderExpandedBoard();

    await patchCell(qc, "i3", "c1", "patched");

    expect(
      screen.getByRole("button", { name: "Item 3 Col 1" }).textContent,
    ).toBe("patched");
    expect(rowBodiesRendered()).toEqual(["Item 3"]);
    expect(rowsRendered()).toEqual(["i3"]);
  });

  it("patching a subitem cell re-renders only the subitem's body", async () => {
    const { qc } = renderExpandedBoard();

    await patchCell(qc, "s1", "c2", "sub-patched");

    expect(
      screen.getByRole("button", { name: "Sub 1 Col 2" }).textContent,
    ).toBe("sub-patched");
    expect(rowBodiesRendered()).toEqual(["Sub 1"]);
    expect(rowsRendered()).toEqual(["s1"]);
  });
});

/**
 * Same budget, with the Board Intelligence provider mounted.
 *
 * The provider recomputes every signal on every cache change, so it sits
 * directly in the cell-edit hot path — and it publishes the active chip's item
 * Set through a context every row subscribes to. These pin that neither costs
 * the table a wider render than the provider-less budget above.
 *
 * The chip is `stalled`, not `overdue`: this fixture has no date column, so
 * `overdue` yields no signal at all and the assertion would be hollow. Every
 * item's `updated_at` is months old and its cells carry no `updated_at`, so
 * the single group IS stalled and all six rows are in the active set — a
 * genuinely active chip with a real match Set.
 */
describe("BoardTable render budget with Board Intelligence", () => {
  function renderIntelBoard() {
    const qc = new QueryClient();
    const p = payloadFixture();
    const view = render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <BoardIntelligenceProvider
            boardId="b1"
            initialData={p}
            members={[]}
            lastSeenAt={null}
            currentUserId="u1"
          >
            <BoardTable payload={p} selectedViewId="v1" />
          </BoardIntelligenceProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    return { ...view, qc };
  }

  async function patchItem1Cell(qc: QueryClient) {
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  afterEach(() => window.history.replaceState(null, "", "/"));

  it("keeps the single-cell budget with the provider mounted and no chip", async () => {
    window.history.replaceState(null, "", "/");
    const { qc } = renderIntelBoard();
    resetProbes();

    await patchItem1Cell(qc);

    expect(
      screen.getByRole("button", { name: "Item 1 Col 1" }).textContent,
    ).toBe("patched");
    // Identical to the provider-less budget: the provider recomputes signals,
    // but with no chip active `IntelMatchContext` stays `null`, so no row
    // subscribes to anything that changed.
    expect(rowsRendered()).toEqual(["i1"]);
    expect(cellRenders.length).toBe(COLUMN_IDS.length);
  });

  it("keeps the single-cell budget with a chip active", async () => {
    window.history.replaceState(null, "", "/?intel=stalled");
    const { qc } = renderIntelBoard();
    // Sanity: the chip really is active — every row is in the match set.
    expect(document.querySelectorAll(".intel-match").length).toBe(
      ITEM_IDS.length,
    );
    resetProbes();

    await patchItem1Cell(qc);

    expect(
      screen.getByRole("button", { name: "Item 1 Col 1" }).textContent,
    ).toBe("patched");
    // Still just the patched row. The cell patch carries no `updated_at`, so
    // the stalled signal's `itemIds` are unchanged; the provider keys the
    // match Set on those ids, so its identity survives and every sibling row
    // bails out. A patch that DID change the set would re-render each row
    // once — that is the ceiling this pins the common case below.
    expect(rowsRendered()).toEqual(["i1"]);
    expect(cellRenders.length).toBe(COLUMN_IDS.length);
    expect(rowBodiesRendered()).toEqual(["Item 1"]);
  });
});
