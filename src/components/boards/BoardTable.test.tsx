import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { reorderPosition } from "@/lib/boards/group-reorder";
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
const updateColumnSettings = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  createGroup: (...a: unknown[]) => createGroup(...a),
  updateGroupColor: (...a: unknown[]) => updateGroupColor(...a),
  deleteGroup: (...a: unknown[]) => deleteGroup(...a),
  addSubitem: (...a: unknown[]) => addSubitem(...a),
  deleteItem: (...a: unknown[]) => deleteItem(...a),
  reorderItem: (...a: unknown[]) => reorderItem(...a),
  updateColumnSettings: (...a: unknown[]) => updateColumnSettings(...a),
}));

// dependency-actions is a server module pulled in transitively by
// useBoardMutations; stub it so it doesn't load server-only code in jsdom.
vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: vi.fn(),
  deleteDependency: vi.fn(),
}));

// collaboration/actions is a server module pulled in by BoardTable +
// useBoardMutations (Files-column upload/preview/delete); stub it for jsdom.
vi.mock("@/lib/collaboration/actions", () => ({
  createAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  getAttachmentPreviewUrls: vi
    .fn()
    .mockResolvedValue({ ok: true, data: { urls: {} } }),
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
  updateColumnSettings.mockReset();
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

  it("shows an AlertDialog before deleting a parent with children", async () => {
    deleteItem.mockResolvedValue({ ok: true, data: undefined });
    renderNested();

    // Open the "Epic" row menu and click Delete
    fireEvent.click(screen.getByLabelText("Epic menu"));
    fireEvent.click(screen.getByText("Delete"));

    // deleteItem must NOT have been called yet — the dialog is open
    expect(deleteItem).not.toHaveBeenCalled();

    // The confirm dialog should be visible
    expect(
      screen.getByText(/permanently deletes the item and all of its subitems/i),
    ).toBeInTheDocument();

    // Clicking the dialog's Delete button confirms
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteItem).toHaveBeenCalledWith({ itemId: "p1" }),
    );
  });

  it("renders the (N) child-count badge next to the chevron", () => {
    renderNested();
    // The badge should show "(2)" for the "Epic" parent which has 2 subitems
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });
});

function childlessPayload() {
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
        id: "t1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Task One",
        position: 0,
      },
    ],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderChildless() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={childlessPayload()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable add-subitem hover button", () => {
  it("shows the Add subitem button on a childless top-level item", async () => {
    addSubitem.mockResolvedValue({
      ok: true,
      data: {
        item: {
          id: "new-s1",
          board_id: "b1",
          org_id: "o1",
          group_id: "g1",
          parent_id: "t1",
          name: "New subitem",
          position: 1,
        },
      },
    });

    renderChildless();

    const btn = screen.getByRole("button", { name: "Add subitem to Task One" });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);

    await waitFor(() =>
      expect(addSubitem).toHaveBeenCalledWith({
        parentId: "t1",
        name: "New subitem",
      }),
    );
  });

  it("calls addSubitem and triggers onSuccess with the new item id", async () => {
    const newItem = {
      id: "new-s1",
      board_id: "b1",
      org_id: "o1",
      group_id: "g1",
      parent_id: "t1",
      name: "New subitem",
      position: 1,
    };
    addSubitem.mockResolvedValue({ ok: true, data: { item: newItem } });

    renderChildless();

    fireEvent.click(
      screen.getByRole("button", { name: "Add subitem to Task One" }),
    );

    // The action is called with the correct args
    await waitFor(() =>
      expect(addSubitem).toHaveBeenCalledWith({
        parentId: "t1",
        name: "New subitem",
      }),
    );

    // After the mutation resolves the parent expands (onToggle fires) and the
    // Expand button becomes a Collapse button.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Collapse Task One" }),
      ).toBeInTheDocument(),
    );
  });
});

function rollupPayload() {
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
    columns: [
      {
        id: "c1",
        board_id: "b1",
        org_id: "o1",
        kind: "numbers",
        name: "Est",
        settings: {},
        position: 0,
        width: null,
      },
    ],
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
    cellValues: [
      {
        item_id: "s1",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { n: 5 },
      },
      {
        item_id: "s2",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { n: 8 },
      },
    ],
    dependencies: [],
    views: [],
  } as never;
}

function twoItemsPayload() {
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
        id: "t1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Task One",
        position: 0,
      },
      {
        id: "t2",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Task Two",
        position: 1,
      },
    ],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderTwoItems() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={twoItemsPayload()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable item drag handle", () => {
  it("renders a reorder handle for each top-level item", () => {
    renderTwoItems();
    expect(
      screen.getByRole("button", { name: "Reorder Task One" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reorder Task Two" }),
    ).toBeInTheDocument();
  });
});

describe("BoardTable rollup", () => {
  it("shows a summed rollup on the collapsed parent and the children on expand", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable payload={rollupPayload()} selectedViewId="v1" />
      </QueryClientProvider>,
    );
    // Collapsed by default → parent row shows the rollup (Σ 13), subitems hidden.
    expect(screen.getByText(/Σ\s*13/)).toBeInTheDocument();
    expect(screen.queryByText("Design")).not.toBeInTheDocument();
    // Expand → children visible, rollup gone (parent shows its own cells).
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.queryByText(/Σ\s*13/)).not.toBeInTheDocument();
  });
});

function footerPayload(settings: Record<string, unknown>) {
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
    columns: [
      {
        id: "c1",
        board_id: "b1",
        org_id: "o1",
        kind: "numbers",
        name: "Est",
        settings,
        position: 0,
        width: null,
      },
    ],
    items: [
      {
        id: "t1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Task One",
        position: 0,
      },
      {
        id: "t2",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Task Two",
        position: 1,
      },
    ],
    cellValues: [
      { item_id: "t1", column_id: "c1", org_id: "o1", board_id: "b1", value: { n: 10 } },
      { item_id: "t2", column_id: "c1", org_id: "o1", board_id: "b1", value: { n: 5 } },
    ],
    dependencies: [],
    views: [],
  } as never;
}

function renderFooter(settings: Record<string, unknown>) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={footerPayload(settings)} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable summary footer (6d-3)", () => {
  it("renders a footer that sums a numbers column over top-level rows", () => {
    renderFooter({ summary_aggregation: "sum" });
    const footer = screen.getByTestId("board-summary-footer");
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveTextContent("Sum");
    expect(footer).toHaveTextContent("15");
  });

  it("shows an editable Summary affordance when no aggregation is chosen", () => {
    renderFooter({});
    const footer = screen.getByTestId("board-summary-footer");
    expect(footer).toHaveTextContent("Summary");
  });

  it("persists a picked aggregation to column settings (merging existing keys)", async () => {
    updateColumnSettings.mockResolvedValue({ ok: true, data: undefined });
    renderFooter({ unit: "$" });
    // open the footer cell picker (the only dropdown button in the footer)
    const footer = screen.getByTestId("board-summary-footer");
    fireEvent.click(footer.querySelector("button")!);
    fireEvent.click(screen.getByText("Average"));
    await waitFor(() =>
      expect(updateColumnSettings).toHaveBeenCalledWith({
        columnId: "c1",
        settings: { unit: "$", summary_aggregation: "avg" },
      }),
    );
  });
});

describe("BoardTable subitem drag-reorder (pure position math)", () => {
  it("computes a subitem reorder position among siblings", () => {
    const siblings = [
      { id: "s1", position: 1 },
      { id: "s2", position: 2 },
      { id: "s3", position: 3 },
    ];
    // drop s3 above s1 → strictly less than 1
    expect(reorderPosition(siblings, "s3", "s1")!).toBeLessThan(1);
  });
});

describe("BoardTable item drag-reorder (pure position math)", () => {
  it("computes a top-level item reorder position among siblings", () => {
    const siblings = [
      { id: "t1", position: 0 },
      { id: "t2", position: 1 },
      { id: "t3", position: 2 },
    ];
    expect(reorderPosition(siblings, "t3", "t1")!).toBeLessThan(0);
    expect(reorderPosition(siblings, "t2", "t2")).toBeNull();
  });
});

function filesColumnPayload() {
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
    columns: [
      {
        id: "c-files",
        board_id: "b1",
        org_id: "o1",
        name: "Files",
        kind: "files",
        settings: {},
        position: 0,
        width: 180,
      },
    ],
    items: [
      {
        id: "t1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Task One",
        position: 0,
      },
    ],
    cellValues: [],
    dependencies: [],
    attachments: [],
    views: [],
  } as never;
}

describe("BoardTable files column", () => {
  it("renders a Files cell with the upload affordance without crashing", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable
          payload={filesColumnPayload()}
          selectedViewId="v1"
          currentUserId="u1"
        />
      </QueryClientProvider>,
    );
    // The empty Files cell shows an "Add file" affordance and a "0 files" group.
    expect(screen.getByLabelText("Add file")).toBeInTheDocument();
    expect(screen.getByLabelText("0 files")).toBeInTheDocument();
  });
});

function manyItemsPayload(count: number) {
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
    items: Array.from({ length: count }, (_, i) => ({
      id: `t${i + 1}`,
      board_id: "b1",
      org_id: "o1",
      group_id: "g1",
      parent_id: null,
      name: `Task ${i + 1}`,
      position: i,
    })),
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderMany(count: number) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={manyItemsPayload(count)} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

function twoGroupsPayload(perGroup: number) {
  const mkItems = (gid: string, prefix: string) =>
    Array.from({ length: perGroup }, (_, i) => ({
      id: `${prefix}${i + 1}`,
      board_id: "b1",
      org_id: "o1",
      group_id: gid,
      parent_id: null,
      name: `${prefix} ${i + 1}`,
      position: i,
    }));
  return {
    board: { id: "b1", org_id: "o1", name: "Board", name_column_width: null },
    groups: [
      { id: "g1", board_id: "b1", org_id: "o1", name: "Group 1", color: "#0073ea", position: 0 },
      { id: "g2", board_id: "b1", org_id: "o1", name: "Group 2", color: "#00c875", position: 1 },
    ],
    columns: [],
    items: [...mkItems("g1", "Alpha"), ...mkItems("g2", "Beta")],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

describe("BoardTable frozen Name column", () => {
  it("does not wrap group rows in a nested scroll container (regression: sticky freeze)", () => {
    renderMany(3);
    const rows = screen.getByTestId("group-rows-g1");
    expect(rows.className).not.toMatch(/overflow-(auto|scroll|x|y)/);
  });

  it("keeps virtualization: a tall group renders a subset of its rows", () => {
    renderMany(60);
    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.queryByText("Task 60")).not.toBeInTheDocument();
  });

  it("marks the Name header and name cells as the freeze edge", () => {
    renderMany(1);
    const headers = document.querySelectorAll(".name-freeze-edge");
    expect(headers.length).toBeGreaterThan(0);
  });

  it("flips data-scrolledx on the scroll container during horizontal scroll", () => {
    renderMany(1);
    const scroller = screen.getByTestId("board-scroll");
    expect(scroller).toHaveAttribute("data-scrolledx", "false");
    scroller.scrollLeft = 120;
    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute("data-scrolledx", "true");
  });

  it("renders windowed rows for every group against the shared scroll container", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable payload={twoGroupsPayload(30)} selectedViewId="v1" />
      </QueryClientProvider>,
    );
    // Each group has its own non-scrolling row area...
    expect(screen.getByTestId("group-rows-g1")).toBeInTheDocument();
    expect(screen.getByTestId("group-rows-g2")).toBeInTheDocument();
    // ...and BOTH groups actually mount rows (guards the "group 2 renders 0
    // rows" regression in the shared-scroll / scrollMargin wiring)...
    expect(screen.getByText("Alpha 1")).toBeInTheDocument();
    expect(screen.getByText("Beta 1")).toBeInTheDocument();
    // ...while still windowing (far-bottom rows of each group are virtualized out).
    expect(screen.queryByText("Alpha 30")).not.toBeInTheDocument();
    expect(screen.queryByText("Beta 30")).not.toBeInTheDocument();
  });
});
