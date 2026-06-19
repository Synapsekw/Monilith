import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "./BoardTable";

// The tanstack virtualizer reads the scroll container's offsetWidth/offsetHeight
// to compute which rows are in-viewport. jsdom always returns 0 for these,
// so the virtualizer emits 0 virtual rows. Stub them to return a real
// viewport height so item rows render during tests.
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

const createGroup = vi.fn();
const updateGroupColor = vi.fn();
const deleteGroup = vi.fn();
const addSubitem = vi.fn();
const deleteItem = vi.fn();
const reorderItem = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  createGroup: (...a: unknown[]) => createGroup(...a),
  updateGroupColor: (...a: unknown[]) => updateGroupColor(...a),
  deleteGroup: (...a: unknown[]) => deleteGroup(...a),
  addSubitem: (...a: unknown[]) => addSubitem(...a),
  deleteItem: (...a: unknown[]) => deleteItem(...a),
  reorderItem: (...a: unknown[]) => reorderItem(...a),
}));

// dependency-actions is a server module pulled in transitively by
// useBoardMutations; stub it so it doesn't load server-only code in jsdom.
vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: vi.fn(),
  deleteDependency: vi.fn(),
}));

// BoardHeader pulls in ViewSwitcher + AutomationsDialog (router + Server
// Actions) that are out of scope here; stub it to a placeholder.
vi.mock("./BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));

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
    columns: [],
    items: [],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderBoard() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={payloadFixture()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createGroup.mockReset();
  updateGroupColor.mockReset();
  deleteGroup.mockReset();
  addSubitem.mockReset();
  deleteItem.mockReset();
  reorderItem.mockReset();
});

describe("BoardTable add group", () => {
  it("creates a group with the next auto-incremented name and drops it into rename mode", async () => {
    createGroup.mockResolvedValue({
      ok: true,
      data: {
        group: {
          id: "g2",
          board_id: "b1",
          org_id: "o1",
          name: "Group 2",
          color: "#0073ea",
          position: 1,
        },
      },
    });

    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));

    await waitFor(() =>
      expect(createGroup).toHaveBeenCalledWith({
        boardId: "b1",
        name: "Group 2",
      }),
    );
    // The new group lands in inline rename mode, pre-filled with its default name.
    expect(await screen.findByDisplayValue("Group 2")).toBeInTheDocument();
  });
});

describe("BoardTable group menu", () => {
  it("sets a group color from the palette", async () => {
    updateGroupColor.mockResolvedValue({ ok: true, data: undefined });
    renderBoard();

    fireEvent.click(screen.getByLabelText("Group 1 group menu"));
    fireEvent.click(screen.getByLabelText("Set color #00c875"));

    await waitFor(() =>
      expect(updateGroupColor).toHaveBeenCalledWith({
        groupId: "g1",
        color: "#00c875",
      }),
    );
  });

  it("deletes a group after confirmation", async () => {
    deleteGroup.mockResolvedValue({ ok: true, data: undefined });
    renderBoard();

    fireEvent.click(screen.getByLabelText("Group 1 group menu"));
    fireEvent.click(screen.getByText("Delete"));
    expect(deleteGroup).not.toHaveBeenCalled(); // dialog open, not confirmed

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteGroup).toHaveBeenCalledWith({ groupId: "g1" }),
    );
  });
});

describe("BoardTable group drag handle", () => {
  it("renders a reorder handle for each group", () => {
    renderBoard();
    expect(
      screen.getByRole("button", { name: "Reorder Group 1" }),
    ).toBeInTheDocument();
  });
});

function nestedPayload() {
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
    columns: [],
    items: [
      {
        id: "p1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Epic",
        position: 0,
      },
      {
        id: "s1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: "p1",
        name: "Design",
        position: 1,
      },
      {
        id: "s2",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: "p1",
        name: "Build",
        position: 2,
      },
    ],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderNested() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={nestedPayload()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable subitems", () => {
  it("hides subitems until the parent is expanded", () => {
    renderNested();
    expect(screen.queryByText("Design")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
  });

  it("shows an Add subitem input under an expanded parent", () => {
    renderNested();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    expect(screen.getByLabelText("Add subitem")).toBeInTheDocument();
  });

  it("deletes a subitem from its row menu", async () => {
    deleteItem.mockResolvedValue({ ok: true, data: undefined });
    renderNested();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    fireEvent.click(screen.getByLabelText("Design menu"));
    fireEvent.click(screen.getByText("Delete")); // subitem: no confirm dialog
    await waitFor(() =>
      expect(deleteItem).toHaveBeenCalledWith({ itemId: "s1" }),
    );
  });
});
