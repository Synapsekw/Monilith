import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarBoard } from "@/components/boards/CalendarBoard";
import { BoardPresenceProvider } from "@/lib/boards/presence-context";
import type { BoardPresence } from "@/lib/boards/use-board-presence";
import type { RosterOccupant } from "@/lib/boards/presence-types";

const setCell = vi.fn();
const addItem = vi.fn();
vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({
    setCell,
    addItem,
    clearCellValue: vi.fn(),
    renameItem: vi.fn(),
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

// 2026-06-16 is "today" per system-reminder. Our dated item falls in June 2026.
const DATE_COL_ID = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const VIEW_ID = "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv";

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
      { id: "i1", name: "Dated Item", group_id: "g1", position: 0 },
      { id: "i3", name: "Undated Item", group_id: "g1", position: 1 },
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: DATE_COL_ID,
        value: { date: "2026-06-10" },
        board_id: "b1",
        org_id: "o1",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    views: [
      {
        id: VIEW_ID,
        kind: "calendar",
        name: "Calendar",
        config: { date_column_id: DATE_COL_ID },
        board_id: "b1",
        org_id: "o1",
        position: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
  } as never;
}

function renderCalendar() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <CalendarBoard
        payload={payloadFixture()}
        members={[]}
        selectedViewId={VIEW_ID}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setCell.mockReset();
  addItem.mockReset();
  push.mockReset();
  refresh.mockReset();
});

describe("CalendarBoard", () => {
  it("renders the 7 weekday headers", () => {
    renderCalendar();
    // All 7 day abbreviations should be present.
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
  });

  it("renders a dated item on the grid", () => {
    renderCalendar();
    expect(screen.getByText("Dated Item")).toBeInTheDocument();
  });

  it("shows an Unscheduled section listing undated items", () => {
    renderCalendar();
    // "Unscheduled" label (with count) must be visible.
    expect(screen.getByText(/unscheduled/i)).toBeInTheDocument();
    // The undated item should appear in the unscheduled section.
    expect(screen.getByText("Undated Item")).toBeInTheDocument();
  });

  it("renders a date-column picker with the configured column selected", () => {
    renderCalendar();
    const select = screen.getByRole("combobox", { name: /date column/i });
    expect(select).toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe(DATE_COL_ID);
  });

  it("shows the board name in the header", () => {
    renderCalendar();
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
    channelStatus: "SUBSCRIBED",
  };
}

function renderCalendarWithPresence(presence: BoardPresence) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardPresenceProvider value={presence}>
        <CalendarBoard
          payload={payloadFixture()}
          members={[]}
          selectedViewId={VIEW_ID}
        />
      </BoardPresenceProvider>
    </QueryClientProvider>,
  );
}

describe("CalendarBoard event presence ring (8c)", () => {
  it("shows an editing indicator on an event another user is manipulating", () => {
    // payloadFixture dates item i1 → target event:i1
    const focusMap = new Map([["event:i1", [occupant({ name: "Sam" })]]]);
    renderCalendarWithPresence(presenceValue(focusMap));
    expect(screen.getByLabelText(/Sam is editing/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/is editing/i)).toHaveLength(1);
  });

  it("does not show a ring for the local (self) user's own focus", () => {
    const focusMap = new Map([
      ["event:i1", [occupant({ userId: "self", isSelf: true })]],
    ]);
    renderCalendarWithPresence(presenceValue(focusMap, "self"));
    expect(screen.queryByLabelText(/is editing/i)).not.toBeInTheDocument();
  });
});

describe("CalendarBoard (no date column)", () => {
  it("shows the empty state when no date column is present", () => {
    const qc = new QueryClient();
    const base = payloadFixture() as unknown as Record<string, unknown>;
    const payloadNoDate = { ...base, columns: [] } as never;
    render(
      <QueryClientProvider client={qc}>
        <CalendarBoard
          payload={payloadNoDate}
          members={[]}
          selectedViewId={VIEW_ID}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/add a date column/i)).toBeInTheDocument();
  });
});
