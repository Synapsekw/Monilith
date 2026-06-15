import { describe, it, expect, vi, beforeEach } from "vitest";
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
  return {
    board: { id: "b1", org_id: "o1", name: "Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [status],
    items: [
      { id: "i1", name: "Card A", group_id: "g1", position: 0 },
      { id: "i2", name: "Card B", group_id: "g1", position: 1 },
    ],
    cellValues: [
      { item_id: "i1", column_id: "status", value: { optionId: "o1" } },
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

function renderKanban() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <KanbanBoard
        payload={payloadFixture()}
        selectedViewId="v2"
        members={[]}
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
