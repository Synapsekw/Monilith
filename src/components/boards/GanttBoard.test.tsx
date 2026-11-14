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
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GanttBoard } from "@/components/boards/GanttBoard";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import type { RosterOccupant } from "@/lib/boards/presence-types";
import { BoardViewPrefsProvider } from "@/lib/boards/view-prefs-context";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";
import { localTodayISO } from "@/lib/boards/overdue";

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

// Probe: the `members` / `grants` arrays GanttBoard hands its header on each
// render (identity matters — they feed memoized children).
const { headerLists } = vi.hoisted(() => ({
  headerLists: [] as { members: unknown; grants: unknown }[],
}));
vi.mock("@/components/boards/BoardHeader", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/boards/BoardHeader")>();
  return {
    ...actual,
    BoardHeader: (props: Parameters<typeof actual.BoardHeader>[0]) => {
      headerLists.push({ members: props.members, grants: props.grants });
      return <actual.BoardHeader {...props} />;
    },
  };
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

const { depContext } = vi.hoisted(() => ({
  depContext: {
    value: { data: { boards: [], items: [] }, isPending: false } as unknown,
  },
}));
vi.mock("@/lib/boards/use-dependency-context", () => ({
  useDependencyContext: () => depContext.value,
}));

const { updateBoardView } = vi.hoisted(() => ({
  updateBoardView: vi.fn(async (_input: unknown) => ({
    ok: true as const,
    data: undefined,
  })),
}));
vi.mock("@/lib/boards/view-actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/boards/view-actions")>();
  return { ...actual, updateBoardView };
});

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
    groups: [
      {
        id: "g1",
        board_id: "b1",
        name: "Group One",
        position: 0,
        color: "#579bfc",
      },
    ],
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

/**
 * A bar's accessible name: "Name", or "Name, Nd late" once the item is open and
 * past due. Fixture dates are all in the past against the real clock, so most
 * bars are late; match either form so these tests do not depend on the date.
 */
function barLabel(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(, \\d+d late)?$`);
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
  depContext.value = { data: { boards: [], items: [] }, isPending: false };
});

describe("GanttBoard", () => {
  it("keeps the default members/grants lists referentially stable across renders", () => {
    const qc = new QueryClient();
    headerLists.length = 0;
    render(
      <QueryClientProvider client={qc}>
        <GanttBoard payload={payloadFixture()} selectedViewId={VIEW_ID} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^week$/i }));
    expect(headerLists.length).toBeGreaterThan(1);
    expect(new Set(headerLists.map((h) => h.members)).size).toBe(1);
    expect(new Set(headerLists.map((h) => h.grants)).size).toBe(1);
  });

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
    groups: [
      {
        id: "g1",
        board_id: "b1",
        name: "Group One",
        position: 0,
        color: "#579bfc",
      },
    ],
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
    // Sanctioned chip geometry + card elevation (not rounded-md or a raw shadow utility).
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
    fireEvent.click(screen.getByLabelText(barLabel("DotOnly")));
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
// Bar resize — live local preview, one write on release
// ---------------------------------------------------------------------------

describe("GanttBoard — bar resize commits once on release", () => {
  beforeEach(() => setCell.mockClear());

  // "Spanned" runs 2026-06-02 → 2026-06-06 (5 days) at month zoom = 10px/day.
  function strip() {
    return screen.getByLabelText("Resize Spanned");
  }
  function barWidth() {
    return (strip().parentElement as HTMLElement).style.width;
  }

  it("previews the new width while dragging without writing", () => {
    renderBoard(twoColPayload());
    expect(barWidth()).toBe("50px");
    fireEvent.pointerDown(strip(), { clientX: 100 });
    fireEvent.pointerMove(strip(), { clientX: 112 });
    fireEvent.pointerMove(strip(), { clientX: 121 });
    fireEvent.pointerMove(strip(), { clientX: 130 });
    expect(barWidth()).toBe("80px");
    expect(setCell).not.toHaveBeenCalled();
  });

  it("fires exactly one mutation on pointerup with the final end date", () => {
    renderBoard(twoColPayload());
    fireEvent.pointerDown(strip(), { clientX: 100 });
    fireEvent.pointerMove(strip(), { clientX: 110 });
    fireEvent.pointerMove(strip(), { clientX: 120 });
    fireEvent.pointerMove(strip(), { clientX: 130 });
    fireEvent.pointerUp(strip(), { clientX: 130 });
    expect(setCell).toHaveBeenCalledTimes(1);
    expect(setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: END_COL,
      value: { date: "2026-06-09" },
    });
    // A stray move after release is not part of the gesture.
    fireEvent.pointerMove(strip(), { clientX: 160 });
    expect(setCell).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the drag ends on the original date", () => {
    renderBoard(twoColPayload());
    fireEvent.pointerDown(strip(), { clientX: 100 });
    fireEvent.pointerMove(strip(), { clientX: 130 });
    fireEvent.pointerMove(strip(), { clientX: 102 });
    fireEvent.pointerUp(strip(), { clientX: 102 });
    expect(setCell).not.toHaveBeenCalled();
    expect(barWidth()).toBe("50px");
  });

  it("never drags the end before the start", () => {
    renderBoard(twoColPayload());
    fireEvent.pointerDown(strip(), { clientX: 100 });
    fireEvent.pointerMove(strip(), { clientX: -200 });
    fireEvent.pointerUp(strip(), { clientX: -200 });
    expect(setCell).toHaveBeenCalledTimes(1);
    expect(setCell).toHaveBeenCalledWith({
      itemId: "i1",
      columnId: END_COL,
      value: { date: "2026-06-02" },
    });
  });

  it("pointercancel drops the preview and writes nothing", () => {
    renderBoard(twoColPayload());
    fireEvent.pointerDown(strip(), { clientX: 100 });
    fireEvent.pointerMove(strip(), { clientX: 130 });
    expect(barWidth()).toBe("80px");
    fireEvent.pointerCancel(strip());
    expect(barWidth()).toBe("50px");
    fireEvent.pointerUp(strip(), { clientX: 130 });
    expect(setCell).not.toHaveBeenCalled();
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

  it("gives the zoom buttons a coarse-pointer touch target (>=44px)", () => {
    renderGantt();
    for (const label of ["week", "month", "quarter", "year"]) {
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
    const handle = screen.getAllByLabelText(/^resize (?!name rail)/i)[0];
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

// ---------------------------------------------------------------------------
// Zoom levels (week / month / quarter / year)
// ---------------------------------------------------------------------------

describe("GanttBoard — zoom levels", () => {
  beforeEach(() => refresh.mockReset());

  it("offers Week, Month, Quarter, and Year zoom levels", () => {
    renderGantt();
    for (const label of ["Week", "Month", "Quarter", "Year"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") }),
      ).toBeInTheDocument();
    }
  });

  it("keeps bars rendered after zooming out to Year (no refetch/nav)", () => {
    renderGantt();
    fireEvent.click(screen.getByRole("button", { name: /^year$/i }));
    // Re-renders at the coarser scale from in-memory data — bars stay mounted.
    expect(screen.getAllByText("Item Alpha").length).toBeGreaterThan(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders header tick labels on a single line (no wrapping)", () => {
    const { container } = renderGantt();
    // Each month/quarter tick label carries whitespace-nowrap so "Jan 26" never
    // breaks onto two lines near the right edge of the grid.
    const ticks = container.querySelectorAll(".border-l.whitespace-nowrap");
    expect(ticks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Sub-item nesting (collapse/expand)
// ---------------------------------------------------------------------------

describe("GanttBoard — sub-item nesting", () => {
  function nestedPayload() {
    const base = payloadFixture() as unknown as {
      items: Array<Record<string, unknown>>;
      cellValues: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    base.items = [
      {
        id: "p1",
        name: "Parent",
        group_id: "g1",
        position: 0,
        parent_id: null,
      },
      { id: "c1", name: "Child", group_id: "g1", position: 0, parent_id: "p1" },
      {
        id: "t2",
        name: "TopTwo",
        group_id: "g1",
        position: 1,
        parent_id: null,
      },
    ];
    base.cellValues = ["p1", "c1", "t2"].map((id, i) => ({
      item_id: id,
      column_id: DATE_COL_ID,
      value: { date: `2026-06-0${i + 2}` },
      board_id: "b1",
      org_id: "o1",
      updated_at: "2026-06-01T00:00:00Z",
    }));
    base.dependencies = [];
    return base as never;
  }

  it("collapses sub-items by default (child bar hidden, parent shows a toggle)", () => {
    renderGantt(nestedPayload());
    expect(
      screen.getByRole("button", { name: /expand sub-items of Parent/i }),
    ).toBeInTheDocument();
    // The child's bar (aria-label = its name) is not mounted while collapsed.
    expect(screen.queryByLabelText(barLabel("Child"))).not.toBeInTheDocument();
    // Top-level rows are still shown.
    expect(screen.getByLabelText(barLabel("Parent"))).toBeInTheDocument();
    expect(screen.getByLabelText(barLabel("TopTwo"))).toBeInTheDocument();
  });

  it("reveals the sub-item when its parent is expanded", () => {
    renderGantt(nestedPayload());
    fireEvent.click(
      screen.getByRole("button", { name: /expand sub-items of Parent/i }),
    );
    expect(screen.getByLabelText(barLabel("Child"))).toBeInTheDocument();
    // The toggle flips to a collapse affordance.
    expect(
      screen.getByRole("button", { name: /collapse sub-items of Parent/i }),
    ).toBeInTheDocument();
  });

  it("shows an UNSCHEDULED parent as a collapsible header so its scheduled sub-items are reachable (QCC shape)", () => {
    const base = payloadFixture() as unknown as {
      items: Array<Record<string, unknown>>;
      cellValues: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    base.items = [
      // Parent has NO date cell → unscheduled, but has a scheduled child.
      { id: "p1", name: "Epic", group_id: "g1", position: 0, parent_id: null },
      { id: "c1", name: "Task", group_id: "g1", position: 0, parent_id: "p1" },
    ];
    base.cellValues = [
      {
        item_id: "c1",
        column_id: DATE_COL_ID,
        value: { date: "2026-06-04" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ];
    base.dependencies = [];
    renderGantt(base as never);
    // The parent appears on the timeline as a header with an expand toggle…
    expect(
      screen.getByRole("button", { name: /expand sub-items of Epic/i }),
    ).toBeInTheDocument();
    // …its scheduled child is hidden until expanded (not stranded/unreachable).
    expect(screen.queryByLabelText(barLabel("Task"))).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /expand sub-items of Epic/i }),
    );
    expect(screen.getByLabelText(barLabel("Task"))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Date sources — Created at / Updated at in the Start/End pickers
// ---------------------------------------------------------------------------

describe("GanttBoard — timestamp date sources", () => {
  function datedPayload() {
    const base = payloadFixture() as unknown as {
      items: Array<Record<string, unknown>>;
    };
    base.items = base.items.map((it, i) => ({
      ...it,
      parent_id: null,
      board_id: "b1",
      org_id: "o1",
      created_at: `2026-05-0${i + 1}T10:00:00.000Z`,
      updated_at: `2026-05-1${i + 1}T10:00:00.000Z`,
    }));
    return base as never;
  }

  it("offers Created at and Updated at in the Start picker", () => {
    renderGantt(datedPayload());
    const start = screen.getByLabelText("Start date column");
    expect(
      within(start).getByRole("option", { name: "Created at" }),
    ).toBeInTheDocument();
    expect(
      within(start).getByRole("option", { name: "Updated at" }),
    ).toBeInTheDocument();
  });

  it("makes bars read-only (no resize handle) when start is a timestamp source", () => {
    renderGantt(datedPayload());
    // A real date column → bars are resizable.
    expect(
      screen.getAllByLabelText(/^resize (?!name rail)/i).length,
    ).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Start date column"), {
      target: { value: "__created_at__" },
    });
    // Timestamp-sourced bars can't be resized — the handle is gone.
    expect(
      screen.queryByLabelText(/^resize (?!name rail)/i),
    ).not.toBeInTheDocument();
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

describe("GanttBoard — cross-board links", () => {
  const OTHER = "99999999-9999-4999-8999-999999999999";

  it("draws a cross-board link as a stub, not an arrow, and navigates on tap", () => {
    depContext.value = {
      isPending: false,
      data: {
        boards: [
          {
            id: OTHER,
            name: "Regulatory",
            can_edit: false,
            date_columns: [],
            timeline_config: null,
            groups: [],
          },
        ],
        items: [
          {
            id: "ext-1",
            board_id: OTHER,
            group_id: "g1",
            parent_id: null,
            name: "Permit",
            position: 0,
            created_at: "",
            updated_at: "",
            dates: {},
          },
        ],
      },
    };
    const payload = payloadFixture() as unknown as {
      dependencies: Array<Record<string, unknown>>;
    };
    payload.dependencies.push({
      id: "x-dep",
      org_id: "o1",
      board_id: "b1",
      predecessor_board_id: OTHER,
      predecessor_id: "ext-1",
      successor_id: "i1",
      type: "FS",
      created_at: "2026-06-01T00:00:00Z",
    });
    const { container } = renderGantt(payload as never);
    // Only the same-board i1 -> i2 link is an arrow.
    expect(container.querySelectorAll("path[marker-end]")).toHaveLength(1);
    const chip = screen.getByRole("button", {
      name: /Waiting on Permit · Regulatory/,
    });
    fireEvent.click(chip);
    expect(push).toHaveBeenCalledWith(`/boards/${OTHER}?item=ext-1`);
  });
});

// ---------------------------------------------------------------------------
// Grouped Gantt — a band per board group, shared collapse, late bars
// ---------------------------------------------------------------------------

describe("GanttBoard — grouped rows", () => {
  function groupedPayload() {
    const base = payloadFixture() as unknown as {
      groups: Array<Record<string, unknown>>;
      items: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    // Listed out of order on purpose: position decides.
    base.groups = [
      {
        id: "g2",
        board_id: "b1",
        name: "Build",
        position: 1,
        color: "#888888",
      },
      {
        id: "g1",
        board_id: "b1",
        name: "Discovery",
        position: 0,
        color: "#579bfc",
      },
      {
        id: "g3",
        board_id: "b1",
        name: "Launch",
        position: 2,
        color: "#888888",
      },
    ];
    base.items = [
      // i1 is dated 2026-06-02 → 06-04, i2 2026-06-10 → 06-12 (payloadFixture).
      {
        id: "i1",
        name: "Item Alpha",
        group_id: "g2",
        position: 0,
        parent_id: null,
      },
      {
        id: "i2",
        name: "Item Beta",
        group_id: "g1",
        position: 0,
        parent_id: null,
      },
      // The only item in Launch has no dates.
      {
        id: "i3",
        name: "Unscheduled Item",
        group_id: "g3",
        position: 0,
        parent_id: null,
      },
    ];
    base.dependencies = [];
    return base as never;
  }
  /** Bands and rows in DOM order, by the full name on their rail label. */
  const railOrder = () =>
    screen
      .getAllByTestId(/^gantt-(section|row)$/)
      .map((el) => el.querySelector("[title]")?.getAttribute("title"));

  it("draws a band per group in position order with its rows under it", () => {
    renderGantt(groupedPayload());
    expect(railOrder()).toEqual([
      "Discovery",
      "Item Beta",
      "Build",
      "Item Alpha",
    ]);
  });

  it("skips a group with nothing on the timeline", () => {
    renderGantt(groupedPayload());
    expect(
      screen.queryByRole("heading", { name: "Launch" }),
    ).not.toBeInTheDocument();
    // Its undated item is still reachable in the Unscheduled section.
    expect(screen.getByText(/Unscheduled \(1\)/)).toBeInTheDocument();
  });

  it("collapsing a group hides its rows and keeps its band", () => {
    renderGantt(groupedPayload());
    fireEvent.click(screen.getByRole("button", { name: "Collapse Discovery" }));
    expect(railOrder()).toEqual(["Discovery", "Build", "Item Alpha"]);
    expect(
      screen.getByRole("button", { name: "Expand Discovery" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("reads and writes the same collapsed set the table uses", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardViewPrefsProvider
          boardId="b1"
          initial={{ ...EMPTY_BOARD_VIEW_PREFS, collapsedGroupIds: ["g1"] }}
        >
          <GanttBoard
            payload={groupedPayload()}
            members={[]}
            selectedViewId={VIEW_ID}
          />
        </BoardViewPrefsProvider>
      </QueryClientProvider>,
    );
    // A group collapsed in the table opens collapsed here.
    expect(railOrder()).toEqual(["Discovery", "Build", "Item Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand Discovery" }));
    expect(railOrder()).toEqual([
      "Discovery",
      "Item Beta",
      "Build",
      "Item Alpha",
    ]);
  });

  it("summarises each group on its band", () => {
    renderGantt(groupedPayload());
    const band = screen
      .getByRole("heading", { name: "Discovery" })
      .closest('[data-testid="gantt-section"]') as HTMLElement;
    // One scheduled item, not done, due in June 2026 → late.
    expect(within(band).getByTestId("gantt-section-meta")).toHaveTextContent(
      "0% · 1 late",
    );
    expect(within(band).getByTestId("gantt-summary")).toBeInTheDocument();
  });

  it("keeps sub-items nested under their parent inside the group", () => {
    const base = groupedPayload() as unknown as {
      items: Array<Record<string, unknown>>;
      cellValues: Array<Record<string, unknown>>;
    };
    base.items.push({
      id: "c1",
      name: "Child",
      group_id: "g1",
      position: 0,
      parent_id: "i2",
    });
    base.cellValues.push({
      item_id: "c1",
      column_id: DATE_COL_ID,
      value: { date: "2026-06-11" },
      board_id: "b1",
      org_id: "o1",
      updated_at: "2026-06-01T00:00:00Z",
    });
    renderGantt(base as never);
    fireEvent.click(
      screen.getByRole("button", { name: /expand sub-items of Item Beta/i }),
    );
    expect(railOrder()).toEqual([
      "Discovery",
      "Item Beta",
      "Child",
      "Build",
      "Item Alpha",
    ]);
  });
});

describe("GanttBoard — late bars and range", () => {
  it("marks an open, past-due item late and leaves a done one alone", () => {
    // twoColPayload: "Spanned" is Done; "DotOnly" (2026-06-03) has no status.
    renderBoard(twoColPayload());
    expect(screen.getByLabelText(barLabel("DotOnly"))).toHaveClass(
      "border-destructive",
    );
    expect(screen.getByLabelText("Spanned").parentElement).not.toHaveClass(
      "border-destructive",
    );
    expect(screen.getByText(/^\d+d late$/)).toBeInTheDocument();
  });

  it("widens the range so today is on the grid even when all dates are old", () => {
    const base = payloadFixture() as unknown as {
      cellValues: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    // One item, 200 days ago. The month window alone is 90 days.
    base.cellValues = [
      {
        item_id: "i1",
        column_id: DATE_COL_ID,
        value: { date: localTodayISO(new Date(Date.now() - 200 * 86_400_000)) },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ];
    base.dependencies = [];
    const { container } = renderGantt(base as never);
    // The header's today line renders only when today is inside the range.
    expect(container.querySelector('[aria-label="Today"]')).not.toBeNull();
  });

  it("puts today on the grid when every date is in the future", () => {
    const base = payloadFixture() as unknown as {
      cellValues: Array<Record<string, unknown>>;
      dependencies: Array<Record<string, unknown>>;
    };
    base.cellValues = [
      {
        item_id: "i1",
        column_id: DATE_COL_ID,
        value: { date: localTodayISO(new Date(Date.now() + 120 * 86_400_000)) },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ];
    base.dependencies = [];
    const { container } = renderGantt(base as never);
    expect(container.querySelector('[aria-label="Today"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Today button + persisted name-rail width
// ---------------------------------------------------------------------------

describe("GanttBoard — Today and the name rail", () => {
  beforeEach(() => {
    updateBoardView.mockClear();
    refresh.mockReset();
    push.mockReset();
  });

  const railHeader = () => screen.getByTestId("gantt-rail-header");
  const railHandle = () =>
    screen.getByRole("separator", { name: /Resize name rail/ });

  it("scrolls the canvas to today from the Today button, with no navigation", () => {
    const { container } = renderGantt();
    const scroller = container.querySelector(
      "[data-scroll-container]",
    ) as HTMLElement;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const arg = scrollTo.mock.calls[0]![0] as {
      left: number;
      behavior: string;
    };
    expect(arg.behavior).toBe("smooth");
    // The fixture starts in June 2026, so today is well to the right of x = 0.
    expect(arg.left).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(updateBoardView).not.toHaveBeenCalled();
  });

  it("gives the Today button a coarse-pointer target through the Button primitive", () => {
    renderGantt();
    // size="sm" of the app Button: 28px on a mouse, 44px on a finger.
    expect(screen.getByRole("button", { name: "Today" }).className).toContain(
      "pointer-coarse:h-11",
    );
  });

  it("opens the rail at 300px, or at the width saved in the view config", () => {
    const { unmount } = renderGantt();
    expect(railHeader()).toHaveStyle({ width: "300px" });
    unmount();
    const base = payloadFixture() as unknown as {
      views: Array<{ config: Record<string, unknown> }>;
    };
    base.views[0]!.config = {
      date_column_id: DATE_COL_ID,
      zoom: "month",
      label_width: 220,
    };
    renderGantt(base as never);
    expect(railHeader()).toHaveStyle({ width: "220px" });
  });

  it("saves the rail width once, on drag end, with the rest of the config", async () => {
    renderGantt();
    fireEvent.pointerDown(railHandle(), { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 340 });
    fireEvent.pointerMove(window, { clientX: 380 });
    expect(updateBoardView).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    await waitFor(() => expect(updateBoardView).toHaveBeenCalledTimes(1));
    expect(updateBoardView).toHaveBeenCalledWith({
      viewId: VIEW_ID,
      config: expect.objectContaining({
        date_column_id: DATE_COL_ID,
        zoom: "month",
        label_width: 380,
      }),
    });
    expect(railHeader()).toHaveStyle({ width: "380px" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the saved width when another setting is saved", async () => {
    const base = payloadFixture() as unknown as {
      views: Array<{ config: Record<string, unknown> }>;
    };
    base.views[0]!.config = {
      date_column_id: DATE_COL_ID,
      zoom: "month",
      label_width: 220,
    };
    renderGantt(base as never);
    fireEvent.click(screen.getByRole("button", { name: /^week$/i }));
    await waitFor(() => expect(updateBoardView).toHaveBeenCalledTimes(1));
    expect(updateBoardView).toHaveBeenCalledWith({
      viewId: VIEW_ID,
      config: expect.objectContaining({ zoom: "week", label_width: 220 }),
    });
  });

  it("lets a viewer resize for the session without writing", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <GanttBoard
          payload={payloadFixture()}
          members={[]}
          selectedViewId={VIEW_ID}
          access="viewer"
        />
      </QueryClientProvider>,
    );
    fireEvent.pointerDown(railHandle(), { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 400 });
    fireEvent.pointerUp(window);
    expect(railHeader()).toHaveStyle({ width: "400px" });
    expect(updateBoardView).not.toHaveBeenCalled();
  });

  it("renders an out-of-range stored width clamped and writes it back clamped", async () => {
    const base = payloadFixture() as unknown as {
      views: Array<{ config: Record<string, unknown> }>;
    };
    base.views[0]!.config = {
      date_column_id: DATE_COL_ID,
      zoom: "month",
      label_width: 9999,
    };
    renderGantt(base as never);
    expect(railHeader()).toHaveStyle({ width: "520px" });
    fireEvent.click(screen.getByRole("button", { name: /^week$/i }));
    await waitFor(() => expect(updateBoardView).toHaveBeenCalledTimes(1));
    expect(updateBoardView).toHaveBeenCalledWith({
      viewId: VIEW_ID,
      config: expect.objectContaining({ zoom: "week", label_width: 520 }),
    });
  });
});
