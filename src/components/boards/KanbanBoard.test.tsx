import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KanbanBoard, onCardDropped } from "@/components/boards/KanbanBoard";

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

// Presence: simulate another user focused (dragging) the card:i1 target so the
// per-card PresenceRing overlay renders. usePresenceFocus reads setFocus from
// the same context, so provide a no-op there too.
vi.mock("@/lib/boards/presence-context", () => ({
  useBoardPresenceContextOptional: () => ({
    selfUserId: "self",
    setFocus: vi.fn(),
    focusMap: new Map([
      [
        "card:i1",
        [
          {
            userId: "u2",
            name: "Sam",
            avatarUrl: null,
            color: "#2d9cdb",
            isSelf: false,
          },
        ],
      ],
    ]),
  }),
}));

// @tanstack/react-virtual reads offsetHeight to measure the scroll container.
// jsdom always returns 0, so the virtualizer would render no cards. Stub it to
// return a realistic value so every card falls within the visible viewport.
let originalOffsetHeight: PropertyDescriptor | undefined;
beforeEach(() => {
  originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
});
afterEach(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      originalOffsetHeight,
    );
  }
});

function payloadFixture() {
  const status = {
    id: "status",
    board_id: "b1",
    org_id: "o1",
    kind: "status",
    name: "Status",
    position: 0,
    settings: {
      options: [
        { id: "o1", label: "Working", color: "#fdab3d" },
        { id: "o2", label: "Done", color: "#00c875" },
      ],
    },
  };
  const owner = {
    id: "owner",
    board_id: "b1",
    org_id: "o1",
    kind: "people",
    name: "Owner",
    position: 1,
    settings: {},
  };
  return {
    board: { id: "b1", org_id: "o1", name: "Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [status, owner],
    items: [
      { id: "i1", name: "Card A", group_id: "g1", position: 0 },
      { id: "i2", name: "Card B", group_id: "g1", position: 1 },
    ],
    cellValues: [
      { item_id: "i1", column_id: "status", value: { optionId: "o1" } },
      { item_id: "i1", column_id: "owner", value: { userIds: ["u1", "u2"] } },
    ],
    views: [
      {
        id: "v2",
        kind: "kanban",
        name: "Kanban",
        config: { group_column_id: "status" },
      },
    ],
  } as never;
}

type TestMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

function renderKanban(members: TestMember[] = []) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <KanbanBoard
        payload={payloadFixture()}
        selectedViewId="v2"
        members={members}
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

describe("KanbanBoard", () => {
  it("renders a No-status column + one column per option", () => {
    renderKanban();
    expect(screen.getByText("No status")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("places each card under its status column", () => {
    renderKanban();
    // Card A (o1=Working) and Card B (No status)
    expect(screen.getByText("Card A")).toBeInTheDocument();
    expect(screen.getByText("Card B")).toBeInTheDocument();
  });

  it("shows a presence indicator on a card another user is manipulating", () => {
    renderKanban();
    // The mocked focusMap has another occupant (Sam) on card:i1 (Card A) but
    // none on card:i2 (Card B), so exactly one "is editing" ring renders.
    expect(screen.getByLabelText(/Sam is editing/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/is editing/i)).toHaveLength(1);
  });

  it("sets the column's status when adding via an option column's + Add", () => {
    // addItem resolves by invoking onSuccess with the created item.
    addItem.mockImplementation(
      (
        _vars: { groupId: string; name: string },
        cb?: { onSuccess?: (item: { id: string }) => void },
      ) => cb?.onSuccess?.({ id: "new-item" }),
    );

    renderKanban();
    const input = screen.getByLabelText("Add item to Working");
    fireEvent.change(input, { target: { value: "Fresh task" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(setCell).toHaveBeenCalledWith({
      itemId: "new-item",
      columnId: "status",
      value: { optionId: "o1" },
    });
  });

  it("does not set a status when adding via the No-status column", () => {
    addItem.mockImplementation(
      (
        _vars: { groupId: string; name: string },
        cb?: { onSuccess?: (item: { id: string }) => void },
      ) => cb?.onSuccess?.({ id: "new-item" }),
    );

    renderKanban();
    const input = screen.getByLabelText("Add item to No status");
    fireEvent.change(input, { target: { value: "Fresh task" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(setCell).not.toHaveBeenCalled();
  });

  it("renders assignee names on the card when a member directory is provided", () => {
    renderKanban([
      {
        userId: "u1",
        fullName: "Ada Lovelace",
        email: "ada@x.com",
        avatarUrl: null,
      },
      { userId: "u2", fullName: null, email: "grace@x.com", avatarUrl: null },
    ]);
    // fullName for u1, email fallback for u2, joined with ", "
    expect(screen.getByText("Ada Lovelace, grace@x.com")).toBeInTheDocument();
  });

  it("falls back to a people count on the card when no directory is provided", () => {
    renderKanban([]); // empty directory
    expect(screen.getByText("2 people")).toBeInTheDocument();
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
  });

  it("uses singular 'person' for a single assignee in the count-fallback", () => {
    const qc = new QueryClient();
    const payload = payloadFixture() as unknown as {
      cellValues: Array<{ item_id: string; column_id: string; value: unknown }>;
    };
    // Override card i1's owner cell to a single assignee.
    payload.cellValues = payload.cellValues.map((c) =>
      c.column_id === "owner" ? { ...c, value: { userIds: ["u1"] } } : c,
    );
    render(
      <QueryClientProvider client={qc}>
        <KanbanBoard
          payload={payload as never}
          selectedViewId="v2"
          members={[]}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("1 person")).toBeInTheDocument();
  });
});

describe("KanbanCard fields", () => {
  it("surfaces a non-grouping status pill, a date, and a percent on the card", () => {
    const qc = new QueryClient();
    const base = payloadFixture() as unknown as {
      columns: Array<Record<string, unknown>>;
      cellValues: Array<{ item_id: string; column_id: string; value: unknown }>;
    };
    base.columns.push(
      {
        id: "stakeholder",
        board_id: "b1",
        org_id: "o1",
        kind: "status",
        name: "Stakeholder",
        position: 2,
        settings: { options: [{ id: "s1", label: "Acme", color: "#66ccff" }] },
      },
      {
        id: "due",
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Due",
        position: 3,
        settings: {},
      },
      {
        id: "progress",
        board_id: "b1",
        org_id: "o1",
        kind: "percent",
        name: "Progress",
        position: 4,
        settings: {},
      },
    );
    base.cellValues.push(
      { item_id: "i1", column_id: "stakeholder", value: { optionId: "s1" } },
      { item_id: "i1", column_id: "due", value: { date: "2026-06-10" } },
      { item_id: "i1", column_id: "progress", value: { percent: 40 } },
    );

    render(
      <QueryClientProvider client={qc}>
        <KanbanBoard payload={base as never} selectedViewId="v2" members={[]} />
      </QueryClientProvider>,
    );

    // Non-grouping status renders as a pill; the grouping "Status" column is the
    // lane and is not duplicated as a card pill.
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    // Date is formatted (month short) — assert the year/day survive formatting.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
});

describe("onCardDropped", () => {
  it("drop on an option writes the status cell", () => {
    const setCellFn = vi.fn();
    const clear = vi.fn();
    onCardDropped(
      "i2",
      "__no_status__",
      { id: "o2", optionId: "o2" } as never,
      "status",
      setCellFn,
      clear,
    );
    expect(setCellFn).toHaveBeenCalledWith({
      itemId: "i2",
      columnId: "status",
      value: { optionId: "o2" },
    });
  });

  it("drop on No-status clears the cell", () => {
    const setCellFn = vi.fn();
    const clear = vi.fn();
    onCardDropped(
      "i1",
      "o1",
      { id: "__no_status__", optionId: null } as never,
      "status",
      setCellFn,
      clear,
    );
    expect(clear).toHaveBeenCalledWith({ itemId: "i1", columnId: "status" });
  });

  it("drop on the same column is a no-op", () => {
    const setCellFn = vi.fn();
    const clear = vi.fn();
    onCardDropped(
      "i1",
      "o1",
      { id: "o1", optionId: "o1" } as never,
      "status",
      setCellFn,
      clear,
    );
    expect(setCellFn).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
