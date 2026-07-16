import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";
import { usePresenceFocusStore } from "@/lib/boards/presence-focus-store";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GanttBoard } from "@/components/boards/GanttBoard";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import type { RosterOccupant } from "@/lib/boards/presence-types";

vi.mock("@/lib/dnd/sensors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dnd/sensors")>();
  return { useTouchAwareSensors: vi.fn(actual.useTouchAwareSensors) };
});

// @tanstack/react-virtual reads the scroll container's offsetHeight to compute
// which rows are in-viewport; jsdom returns 0, which would render no rows. Stub
// it to a realistic viewport so a window of scheduled rows mounts.
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

const setCell = vi.fn();
const addItem = vi.fn();
const clearCellValue = vi.fn();
const addDependency = vi.fn();
const removeDependency = vi.fn();

vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({
    setCell,
    addItem,
    clearCellValue,
    renameItem: vi.fn(),
    addDependency,
    removeDependency,
  }),
}));
vi.mock("@/lib/boards/use-board-realtime", () => ({
  useBoardRealtime: vi.fn(),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const DATE_COL_ID = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const VIEW_ID = "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv";
const DEP_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function payloadFixture() {
  return {
    board: { id: "b1", org_id: "o1", name: "My Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [
      {
        id: DATE_COL_ID,
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Due Date",
        position: 0,
        settings: {},
      },
    ],
    items: [
      { id: "i1", name: "Item Alpha", group_id: "g1", position: 0 },
      { id: "i2", name: "Item Beta", group_id: "g1", position: 1 },
      { id: "i3", name: "Unscheduled Item", group_id: "g1", position: 2 },
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: DATE_COL_ID,
        value: { date: "2026-06-02", end: "2026-06-04" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        item_id: "i2",
        column_id: DATE_COL_ID,
        value: { date: "2026-06-10", end: "2026-06-12" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    views: [
      {
        id: VIEW_ID,
        kind: "timeline",
        name: "Timeline",
        config: { date_column_id: DATE_COL_ID, zoom: "month" },
        board_id: "b1",
        org_id: "o1",
        position: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    dependencies: [
      {
        id: DEP_ID,
        org_id: "o1",
        board_id: "b1",
        predecessor_id: "i1",
        successor_id: "i2",
        type: "FS",
        created_at: "2026-06-01T00:00:00Z",
      },
    ],
  } as never;
}

function renderGantt(payload = payloadFixture()) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <GanttBoard payload={payload} members={[]} selectedViewId={VIEW_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setCell.mockReset();
  addItem.mockReset();
  addDependency.mockReset();
  removeDependency.mockReset();
  push.mockReset();
  refresh.mockReset();
});

describe("GanttBoard", () => {
  it("renders the board name in the header", () => {
    renderGantt();
    expect(screen.getByText("My Board")).toBeInTheDocument();
  });

  it("renders a bar row for each scheduled item", () => {
    renderGantt();
    // Each scheduled item name appears in both the label rail and the bar,
    // so use getAllByText and assert at least one match.
    expect(screen.getAllByText("Item Alpha").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Item Beta").length).toBeGreaterThan(0);
  });

  it("renders an Unscheduled section containing the unscheduled item", () => {
    renderGantt();
    // The toggle button text contains "Unscheduled (n)" — use getAllByText since
    // the item name "Unscheduled Item" also contains the word.
    expect(screen.getAllByText(/unscheduled/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Unscheduled Item")).toBeInTheDocument();
  });

  it("shows the board name in the header", () => {
    renderGantt();
    expect(screen.getByText("My Board")).toBeInTheDocument();
  });

  it("renders the name-rail section header with the kicker recipe", () => {
    renderGantt();
    // The sticky name-rail column header reads "Item".
    const header = screen.getByText("Item");
    expect(header).toHaveClass("font-mono", "text-kicker", "uppercase");
  });
});

function occupant(over: Partial<RosterOccupant>): RosterOccupant {
  return {
    userId: "u2",
    name: "Sam",
    avatarUrl: null,
    color: "#2d9cdb",
    isSelf: false,
    ...over,
  };
}

function presenceValue(
  focusMap: Map<string, RosterOccupant[]>,
  selfUserId = "self",
): BoardPresenceContextValue {
  return {
    roster: [],
    focusMap,
    setFocus: vi.fn(),
    selfUserId,
    selfFocusTargetId: null,
    channelStatus: "SUBSCRIBED",
    flashTargetId: null,
  };
}

function renderGanttWithPresence(presence: BoardPresenceContextValue) {
  // PresenceRing/usePresenceFocus read the presence focus store now — seed it.
  usePresenceFocusStore.getState().syncPresence({
    focusMap: presence.focusMap,
    flashTargetId: presence.flashTargetId,
    selfUserId: presence.selfUserId,
    setFocus: presence.setFocus,
  });
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardPresenceProvider value={presence}>
        <GanttBoard
          payload={payloadFixture()}
          members={[]}
          selectedViewId={VIEW_ID}
        />
      </BoardPresenceProvider>
    </QueryClientProvider>,
  );
}

describe("GanttBoard bar presence ring (8c)", () => {
  afterEach(() => usePresenceFocusStore.getState().reset());
  it("shows an editing indicator on a bar another user is manipulating", () => {
    // payloadFixture schedules item i1 (Item Alpha) → target event:i1
    const focusMap = new Map([["event:i1", [occupant({ name: "Sam" })]]]);
    renderGanttWithPresence(presenceValue(focusMap));
    expect(screen.getByLabelText(/Sam is editing/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/is editing/i)).toHaveLength(1);
  });

  it("does not show a ring for the local (self) user's own focus", () => {
    const focusMap = new Map([
      ["event:i1", [occupant({ userId: "self", isSelf: true })]],
    ]);
    renderGanttWithPresence(presenceValue(focusMap, "self"));
    expect(screen.queryByLabelText(/is editing/i)).not.toBeInTheDocument();
  });
});

describe("GanttBoard (no date column)", () => {
  it("shows the empty state when no date column is present", () => {
    const qc = new QueryClient();
    const base = payloadFixture() as unknown as Record<string, unknown>;
    const payloadNoDate = { ...base, columns: [] } as never;
    render(
      <QueryClientProvider client={qc}>
        <GanttBoard
          payload={payloadNoDate}
          members={[]}
          selectedViewId={VIEW_ID}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/add a date column/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Two-column span + colorization fixtures
// ---------------------------------------------------------------------------

const START_COL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const END_COL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STATUS_COL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PERCENT_COL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function twoColPayload() {
  return {
    board: { id: "b1", org_id: "o1", name: "My Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [
      {
        id: START_COL,
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Start Date",
        position: 0,
        settings: {},
      },
      {
        id: END_COL,
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Due Date",
        position: 1,
        settings: {},
      },
      {
        id: STATUS_COL,
        board_id: "b1",
        org_id: "o1",
        kind: "status",
        name: "Status",
        position: 2,
        settings: {
          options: [
            { id: "o1", label: "Done", color: "#00c875" },
            { id: "o2", label: "Stuck", color: "#e2445c" },
          ],
        },
      },
      {
        id: PERCENT_COL,
        board_id: "b1",
        org_id: "o1",
        kind: "percent",
        name: "% complete",
        position: 3,
        settings: {},
      },
    ],
    items: [
      { id: "i1", name: "Spanned", group_id: "g1", position: 0 },
      { id: "i2", name: "DotOnly", group_id: "g1", position: 1 },
      { id: "i3", name: "Nothing", group_id: "g1", position: 2 },
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: START_COL,
        value: { date: "2026-06-02" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        item_id: "i1",
        column_id: END_COL,
        value: { date: "2026-06-06" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        item_id: "i1",
        column_id: STATUS_COL,
        value: { optionId: "o1" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        item_id: "i2",
        column_id: START_COL,
        value: { date: "2026-06-03" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    views: [
      {
        id: VIEW_ID,
        kind: "timeline",
        name: "Timeline",
        config: {
          date_column_id: START_COL,
          end_column_id: END_COL,
          // Pre-select the status column so the bar renders with its color
          // on first paint — no picker interaction needed to assert colorization.
          color_column_id: STATUS_COL,
          zoom: "month",
        },
        board_id: "b1",
        org_id: "o1",
        position: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  } as never;
}

/** Shared render helper for the two-column tests — mirrors renderGantt. */
function renderBoard(payload: ReturnType<typeof twoColPayload>) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <GanttBoard payload={payload} members={[]} selectedViewId={VIEW_ID} />
    </QueryClientProvider>,
  );
}

describe("GanttBoard — two-column spans + color", () => {
  beforeEach(() => {
    setCell.mockClear();
    refresh.mockClear();
  });

  it("renders a spanned item, a dot, and an unscheduled item", () => {
    renderBoard(twoColPayload());
    // Each scheduled item name appears in both the label rail and the bar;
    // assert at least one match per item.
    expect(screen.getAllByText("Spanned").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DotOnly").length).toBeGreaterThan(0);
    // i3 has no dates → Unscheduled section
    expect(screen.getByText(/Unscheduled \(1\)/)).toBeInTheDocument();
  });

  it("colors the spanned bar from its status option as a soft pill", () => {
    renderBoard(twoColPayload());
    // The bar body (drag handle) carries the item name as its aria-label; its
    // parent is the colored bar surface.
    const bar = screen.getByLabelText("Spanned").parentElement as HTMLElement;
    expect(bar).not.toBeNull();
    // Keystone soft treatment: the hue flows through as the --pill tint var, not
    // an opaque inline background fill.
    expect(bar.style.getPropertyValue("--pill")).toBe("#00c875");
    expect(bar.style.backgroundColor).toBe("");
    // Sanctioned chip geometry + card elevation (not rounded-md/shadow-sm).
    expect(bar.className).toContain("rounded-sm");
    expect(bar.className).toContain("shadow-card");
  });

  it("does not call router.refresh when changing the Color by picker", () => {
    renderBoard(twoColPayload());
    fireEvent.change(screen.getByLabelText("Color by column"), {
      target: { value: STATUS_COL },
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Quick-edit peek (calendar/timeline inline status + percent editing)
// ---------------------------------------------------------------------------

function itemParam(): string | null {
  return new URLSearchParams(window.location.search).get("item");
}

describe("GanttBoard — quick-edit peek", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    setCell.mockReset();
    clearCellValue.mockReset();
    refresh.mockReset();
  });

  it("opens the quick-edit peek when a bar is clicked", () => {
    // twoColPayload: "Spanned" is a two-column bar; status + percent columns exist.
    renderBoard(twoColPayload());
    fireEvent.click(screen.getByLabelText("Spanned")); // bar body (drag handle)
    expect(
      screen.getByRole("dialog", { name: "Edit Spanned" }),
    ).toBeInTheDocument();
    expect(itemParam()).toBeNull(); // peek, not the panel
  });

  it("opens the peek from the keyboard (Enter on the bar body)", () => {
    renderBoard(twoColPayload());
    fireEvent.keyDown(screen.getByLabelText("Spanned"), { key: "Enter" });
    expect(
      screen.getByRole("dialog", { name: "Edit Spanned" }),
    ).toBeInTheDocument();
  });

  it("commits a status pick from the peek through setCell (no router nav)", () => {
    renderBoard(twoColPayload());
    fireEvent.click(screen.getByLabelText("Spanned"));
    fireEvent.click(screen.getByRole("option", { name: "Stuck" }));
    expect(setCell).toHaveBeenCalledOnce();
    expect(setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: STATUS_COL,
      value: { optionId: "o2" },
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the peek from a milestone diamond", () => {
    renderBoard(twoColPayload());
    // "DotOnly" has a start but no end → milestone diamond with an aria-label.
    fireEvent.click(screen.getByLabelText("DotOnly"));
    expect(
      screen.getByRole("dialog", { name: "Edit DotOnly" }),
    ).toBeInTheDocument();
  });

  it("opens the peek from an unscheduled row", () => {
    renderBoard(twoColPayload());
    fireEvent.click(screen.getByText(/Unscheduled \(1\)/)); // expand the section
    fireEvent.click(screen.getByRole("button", { name: "Nothing" }));
    expect(
      screen.getByRole("dialog", { name: "Edit Nothing" }),
    ).toBeInTheDocument();
  });

  it("the peek's Open button pushes ?item= via the History API", () => {
    renderBoard(twoColPayload());
    fireEvent.click(screen.getByLabelText("Spanned"));
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(itemParam()).toBe("i1");
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("resize-strip pointerdown does not open the peek", () => {
    renderBoard(twoColPayload());
    const strip = screen.getByLabelText("Resize Spanned");
    fireEvent.pointerDown(strip);
    fireEvent.click(strip);
    expect(
      screen.queryByRole("dialog", { name: /^edit /i }),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TOUCH Batch 2 — iPad touch ergonomics (coarse pointer)
// ---------------------------------------------------------------------------

describe("GanttBoard — touch ergonomics (Batch 2)", () => {
  it("wires the bar-move DndContext to the shared touch-aware sensors", () => {
    renderGantt();
    expect(useTouchAwareSensors).toHaveBeenCalled();
  });

  it("gives the Week/Month zoom buttons a coarse-pointer touch target (>=44px)", () => {
    renderGantt();
    for (const label of ["week", "month"]) {
      const btn = screen.getByRole("button", {
        name: new RegExp(`^${label}$`, "i"),
      });
      expect(btn.className).toContain("pointer-coarse:min-h-11");
    }
  });

  it("makes the per-row dependency menu always-visible and >=44px on coarse pointers", () => {
    renderGantt();
    // The per-row dependency menu trigger: "Options for <item name>" (distinct
    // from the ViewSwitcher's "View options for …" header buttons).
    const trigger = screen.getByRole("button", {
      name: "Options for Item Alpha",
    });
    expect(trigger.className).toContain("pointer-coarse:opacity-100");
    expect(trigger.className).toContain("pointer-coarse:size-11");
  });

  it("gives the bar resize handle a coarse hit area and touch-none", () => {
    renderGantt();
    const handle = screen.getAllByLabelText(/^resize /i)[0];
    expect(handle.className).toContain("touch-none");
    expect(handle.className).toContain("pointer-coarse:w-11");
  });

  it("gives the Start/End/Color-by selects a coarse-pointer touch target (>=44px)", () => {
    renderGantt();
    for (const label of [
      "Start date column",
      "End date column",
      "Color by column",
    ]) {
      expect(screen.getByLabelText(label).className).toContain(
        "pointer-coarse:min-h-11",
      );
    }
  });
});

describe("GanttBoard — effective-critical name-rail dot", () => {
  function criticalPayload() {
    const base = payloadFixture() as unknown as {
      items: Array<Record<string, unknown>>;
      cellValues: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    // Add a third scheduled item and a second edge from i1, giving i1 two
    // direct dependents (auto-critical). i2 keeps a single predecessor.
    base.items.push({
      id: "i4",
      name: "Item Gamma",
      group_id: "g1",
      position: 3,
    });
    base.cellValues.push({
      item_id: "i4",
      column_id: DATE_COL_ID,
      value: { date: "2026-06-20", end: "2026-06-22" },
      board_id: "b1",
      org_id: "o1",
      updated_at: "2026-06-01T00:00:00Z",
    });
    base.dependencies.push({
      id: "dep-2",
      org_id: "o1",
      board_id: "b1",
      predecessor_id: "i1",
      successor_id: "i4",
      type: "FS",
      created_at: "2026-06-01T00:00:00Z",
    });
    return base as never;
  }

  it("marks an item with 2+ dependents with the auto-critical dot", () => {
    renderGantt(criticalPayload());
    expect(
      screen.getByTitle("Critical (auto) — 2 items depend on this"),
    ).toBeInTheDocument();
  });

  it("does not mark items below the threshold", () => {
    renderGantt(); // base fixture: i1 has exactly 1 dependent
    expect(screen.queryByTitle(/Critical/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Row virtualization (B3a) — only a window of scheduled rows mounts
// ---------------------------------------------------------------------------

describe("GanttBoard — timeline row virtualization", () => {
  function manyScheduledPayload(count: number) {
    const base = payloadFixture() as unknown as {
      items: Array<Record<string, unknown>>;
      cellValues: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    const items = Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      name: `Row ${i}`,
      group_id: "g1",
      position: i,
    }));
    const cellValues = items.map((it, i) => ({
      item_id: it.id,
      column_id: DATE_COL_ID,
      // Spread across June so every row is scheduled (has a valid start date).
      value: { date: `2026-06-${String((i % 27) + 1).padStart(2, "0")}` },
      board_id: "b1",
      org_id: "o1",
      updated_at: "2026-06-01T00:00:00Z",
    }));
    base.items = items;
    base.cellValues = cellValues;
    base.dependencies = [];
    return base as never;
  }

  it("mounts only a window of scheduled rows on a large board", () => {
    renderGantt(manyScheduledPayload(200));
    const rows = screen.getAllByTestId("gantt-row");
    // Windowed: a viewport's worth (+overscan), never all 200.
    expect(rows.length).toBeLessThan(60);
    expect(rows.length).toBeGreaterThan(0);
  });
});
