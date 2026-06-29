import { describe, it, expect, vi, beforeEach } from "vitest";
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

const setCell = vi.fn();
const addItem = vi.fn();
const addDependency = vi.fn();
const removeDependency = vi.fn();

vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({
    setCell,
    addItem,
    clearCellValue: vi.fn(),
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
        settings: { options: [{ id: "o1", label: "Done", color: "#00c875" }] },
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

  it("colors the spanned bar from its status option", () => {
    renderBoard(twoColPayload());
    // The bar span (smaller text-[11px]) is the element inside the colored bar div.
    // Find it by matching the exact bar text class — it's the only span at 11px.
    const barSpan = screen
      .getAllByText("Spanned")
      .find(
        (el) => el.tagName === "SPAN" && el.className.includes("text-[11px]"),
      );
    expect(barSpan).toBeDefined();
    // Walk up to the bar div that carries the inline backgroundColor
    const bar = barSpan!.closest("[style*='background']") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.backgroundColor).toBe("rgb(0, 200, 117)"); // #00c875
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
