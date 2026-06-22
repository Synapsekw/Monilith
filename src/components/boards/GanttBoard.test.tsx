import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GanttBoard } from "@/components/boards/GanttBoard";
import { BoardPresenceProvider } from "@/lib/boards/presence-context";
import type { BoardPresence } from "@/lib/boards/use-board-presence";
import type { RosterOccupant } from "@/lib/boards/presence-types";

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
): BoardPresence {
  return {
    roster: [],
    focusMap,
    setFocus: vi.fn(),
    selfUserId,
    selfFocusTargetId: null,
    channelStatus: "SUBSCRIBED",
  };
}

function renderGanttWithPresence(presence: BoardPresence) {
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
