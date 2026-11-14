import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";
import { reorderPosition } from "@/lib/boards/group-reorder";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { useBoardSelection } from "@/stores/board-selection";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "./BoardTable";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import { usePresenceFocusStore } from "@/lib/boards/presence-focus-store";
import type { RosterOccupant } from "@/lib/boards/presence-types";
import { BoardViewPrefsProvider } from "@/lib/boards/view-prefs-context";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";
import { BoardIntelligenceProvider } from "@/lib/boards/intelligence/context";
import { localTodayISO } from "@/lib/boards/overdue";
import { NAME_FREEZE_RULE } from "@/components/boards/SummaryRow";

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
// Deletes are now soft-deletes: the hook's deleteGroup/deleteItem aliases call
// the archive server actions, so the row/group menus exercise these.
const archiveGroup = vi.fn();
const archiveItem = vi.fn();
const reorderItem = vi.fn();
const updateColumnSettings = vi.fn();
const resizeColumn = vi.fn();
const resetColumnWidths = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  createGroup: (...a: unknown[]) => createGroup(...a),
  updateGroupColor: (...a: unknown[]) => updateGroupColor(...a),
  deleteGroup: (...a: unknown[]) => deleteGroup(...a),
  addSubitem: (...a: unknown[]) => addSubitem(...a),
  deleteItem: (...a: unknown[]) => deleteItem(...a),
  archiveGroup: (...a: unknown[]) => archiveGroup(...a),
  archiveItem: (...a: unknown[]) => archiveItem(...a),
  reorderItem: (...a: unknown[]) => reorderItem(...a),
  updateColumnSettings: (...a: unknown[]) => updateColumnSettings(...a),
  resizeColumn: (...a: unknown[]) => resizeColumn(...a),
  resetColumnWidths: (...a: unknown[]) => resetColumnWidths(...a),
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
  BoardHeader: ({ onFitAllColumns }: { onFitAllColumns?: () => void }) => (
    <div data-testid="board-header">
      {onFitAllColumns ? (
        <button
          type="button"
          data-testid="board-header-fit"
          onClick={onFitAllColumns}
        >
          Fit all columns
        </button>
      ) : null}
    </div>
  ),
}));

// BoardTable now reads filter/sort/search state from the URL via
// useBoardFilterSort → useSearchParams. Default to an empty (no-filter) param
// set so existing rows still render. `searchParamsOverride` lets one describe
// block (the intel-narrowing suite below) opt into a real `intel=` selection
// without affecting any other test in this file — it is reset to null in that
// block's own afterEach.
let searchParamsOverride: string | null = null;
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsOverride ?? ""),
}));

// The view-prefs provider persists through a real Server Action, which cannot
// run in jsdom. Stub it so mounting the provider stays inert.
vi.mock("@/lib/boards/view-prefs-actions", () => ({
  saveBoardViewPrefs: vi.fn(async () => ({ ok: true, data: undefined })),
}));

// Identity check for the shared touch-aware sensor hook. When `sensorsSentinel`
// is set, the mocked hook hands that one object to every caller (still running
// the real hook so hook order and dnd-kit stay valid), and the DndContext
// wrapper below records the `sensors` prop each context receives. A context
// that stops using the shared hook therefore fails an identity assertion, which
// a render count could not catch. See the TOUCH Batch-2 table spec §5.
let sensorsSentinel: unknown = null;
const dndContextProps: { id?: string; sensors?: unknown }[] = [];
vi.mock("@/lib/dnd/sensors", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/dnd/sensors")>(
      "@/lib/dnd/sensors",
    );
  return {
    useTouchAwareSensors: (
      ...args: Parameters<typeof actual.useTouchAwareSensors>
    ) => {
      const real = actual.useTouchAwareSensors(...args);
      return sensorsSentinel ?? real;
    },
  };
});
vi.mock("@dnd-kit/core", async () => {
  const actual =
    await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      dndContextProps.push({ id: props.id, sensors: props.sensors });
      return <actual.DndContext {...props} />;
    },
  };
});

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
  archiveGroup.mockReset();
  archiveItem.mockReset();
  reorderItem.mockReset();
  updateColumnSettings.mockReset();
  resizeColumn.mockReset();
  resetColumnWidths.mockReset();
  sensorsSentinel = null;
  dndContextProps.length = 0;
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

describe("BoardTable read-only access", () => {
  // Proves the wiring, not just the leaf components: the board's own
  // `canEdit = access !== "viewer"` must reach AddItemRow / AddGroupRow. This is
  // what an offline board renders (OfflineBoard passes access="viewer").
  function renderBoardAs(access: "owner" | "viewer") {
    const qc = new QueryClient();
    return render(
      <QueryClientProvider client={qc}>
        <BoardTable
          payload={payloadFixture()}
          selectedViewId="v1"
          access={access}
        />
      </QueryClientProvider>,
    );
  }

  it("shows the add-item and add-group affordances to editors", () => {
    renderBoardAs("owner");
    expect(screen.getByLabelText("Add item")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add group" }),
    ).toBeInTheDocument();
  });

  it("hides the add-item and add-group affordances from viewers", () => {
    renderBoardAs("viewer");
    expect(screen.queryByLabelText("Add item")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add group" }),
    ).not.toBeInTheDocument();
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

  it("archives a group (moves to Trash) after confirmation", async () => {
    archiveGroup.mockResolvedValue({ ok: true, data: undefined });
    renderBoard();

    fireEvent.click(screen.getByLabelText("Group 1 group menu"));
    fireEvent.click(screen.getByText("Delete"));
    expect(archiveGroup).not.toHaveBeenCalled(); // dialog open, not confirmed

    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    await waitFor(() =>
      expect(archiveGroup).toHaveBeenCalledWith({ groupId: "g1" }),
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

  it("saves an inline subitem on a single Enter without entering rename mode", async () => {
    addSubitem.mockResolvedValue({
      ok: true,
      data: {
        item: {
          id: "s3",
          board_id: "b1",
          org_id: "o1",
          group_id: "g1",
          parent_id: "p1",
          name: "Wireframes",
          position: 3,
        },
      },
    });

    renderNested();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));

    const input = screen.getByLabelText("Add subitem");
    fireEvent.change(input, { target: { value: "Wireframes" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // A single Enter commits the add with the typed name…
    await waitFor(() =>
      expect(addSubitem).toHaveBeenCalledWith({
        parentId: "p1",
        name: "Wireframes",
      }),
    );

    // …and the new subitem is NOT dropped into rename mode (which previously
    // required a second Enter to dismiss), so no rename input appears…
    expect(
      screen.queryByLabelText("Rename Wireframes"),
    ).not.toBeInTheDocument();

    // …and the add-subitem input clears, ready for the next entry.
    await waitFor(() =>
      expect(screen.getByLabelText("Add subitem")).toHaveValue(""),
    );
  });

  it("deletes a subitem from its row menu", async () => {
    archiveItem.mockResolvedValue({ ok: true, data: undefined });
    renderNested();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    fireEvent.click(screen.getByLabelText("Design menu"));
    fireEvent.click(screen.getByText("Delete")); // subitem: no confirm dialog
    await waitFor(() =>
      expect(archiveItem).toHaveBeenCalledWith({ itemId: "s1" }),
    );
  });

  it("shows an AlertDialog before deleting a parent with children", async () => {
    archiveItem.mockResolvedValue({ ok: true, data: undefined });
    renderNested();

    // Open the "Epic" row menu and click Delete
    fireEvent.click(screen.getByLabelText("Epic menu"));
    fireEvent.click(screen.getByText("Delete"));

    // archiveItem must NOT have been called yet — the dialog is open
    expect(archiveItem).not.toHaveBeenCalled();

    // The confirm dialog should be visible with reversible Trash copy.
    expect(
      screen.getByText(/moves the item and all of its subitems to trash/i),
    ).toBeInTheDocument();

    // Clicking the dialog's confirm button archives (moves to Trash)
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    await waitFor(() =>
      expect(archiveItem).toHaveBeenCalledWith({ itemId: "p1" }),
    );
  });

  it("renders the (N) child-count badge next to the chevron", () => {
    renderNested();
    // The badge should show "(2)" for the "Epic" parent which has 2 subitems
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });
});

/**
 * Fixture for the intel-narrowing regression below: a parent ("Epic") that
 * never matches the active "overdue" chip itself, with exactly one sub-item
 * ("Design") that does (a date cell two days in the past). Real signals run
 * on the FULL flat item list (parents and sub-items alike), so `itemIds`
 * for the "overdue" signal is `["s1"]` — the parent is never in it.
 */
function subitemMatchPayload() {
  const now = new Date();
  const twoDaysAgo = localTodayISO(new Date(now.getTime() - 2 * 86_400_000));
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
        id: "c-date",
        board_id: "b1",
        org_id: "o1",
        name: "Due",
        kind: "date",
        position: 0,
        settings: {},
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
        updated_at: now.toISOString(),
      },
      {
        id: "s1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: "p1",
        name: "Design",
        position: 1,
        updated_at: now.toISOString(),
      },
    ],
    cellValues: [
      {
        item_id: "s1",
        column_id: "c-date",
        value: { date: twoDaysAgo },
        updated_at: now.toISOString(),
      },
    ],
    dependencies: [],
    views: [],
  } as never;
}

function renderSubitemMatch() {
  const qc = new QueryClient();
  const payload = subitemMatchPayload();
  return render(
    <QueryClientProvider client={qc}>
      <BoardIntelligenceProvider
        boardId="b1"
        initialData={payload}
        members={[]}
        lastSeenAt={null}
        currentUserId="u1"
      >
        <BoardTable payload={payload} selectedViewId="v1" />
      </BoardIntelligenceProvider>
    </QueryClientProvider>,
  );
}

describe("BoardTable intel narrowing", () => {
  beforeEach(() => {
    searchParamsOverride = "intel=overdue";
  });
  afterEach(() => {
    searchParamsOverride = null;
  });

  it("keeps a matching sub-item's parent visible and the sub-item reachable under it", () => {
    renderSubitemMatch();
    // Regression guard: narrowItemsToSignal used to run per-group over
    // TOP-LEVEL items only, so it never saw the parent/child pair together and
    // dropped "Epic" even though its sub-item "Design" matched the chip. The
    // parent row — and its Expand affordance — must still render.
    expect(
      screen.getByRole("button", { name: "Expand Epic" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Design")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));
    expect(screen.getByText("Design")).toBeInTheDocument();
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

  it("expands the parent immediately, not when the mutation resolves", async () => {
    // A collapsed parent renders RollupValueCells over its children. The
    // optimistic temp subitem lands at `onMutate` — so a parent that only
    // expands in `onSuccess` spends the whole round-trip rolling up a
    // value-less row, and its own cell values visibly blank out and come back.
    let resolveAdd: (v: unknown) => void = () => {};
    addSubitem.mockImplementation(
      () => new Promise((resolve) => (resolveAdd = resolve)),
    );

    renderChildless();
    fireEvent.click(
      screen.getByRole("button", { name: "Add subitem to Task One" }),
    );

    // The optimistic temp subitem has landed (childCount 0→1) but the server
    // has NOT answered yet — the exact window the bug lived in.
    await waitFor(() => expect(addSubitem).toHaveBeenCalled());
    // The parent is already expanded, so the temp subitem is its own row rather
    // than a value-less child rolled up into the parent's cells.
    expect(
      screen.getByRole("button", { name: "Collapse Task One" }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveAdd({
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
    });
    // …and it does not toggle back shut when the mutation lands.
    expect(
      screen.getByRole("button", { name: "Collapse Task One" }),
    ).toBeInTheDocument();
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

describe("BoardTable item row — Quiet Grid (no vertical rules)", () => {
  it("renders no cell in an item row with a border-l class", () => {
    // Regression for the whole-branch review's Blocker 1: the created-by and
    // created-at trailing cells in ItemRow were the only surviving vertical
    // rules in the board table (SortableSubitemRow already dropped theirs).
    // Assert on real rendered output — every item row (`data-intel-rule`
    // marks the row) and every element inside it — not just the one column
    // header ColumnHeader.test.tsx already covers.
    const { container } = renderTwoItems();
    const rows = container.querySelectorAll('[data-intel-rule="cell"]');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.getAttribute("class") ?? "").not.toMatch(/\bborder-l\b/);
      for (const cell of row.querySelectorAll("*")) {
        expect(cell.getAttribute("class") ?? "").not.toMatch(/\bborder-l\b/);
      }
    }
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

function groupPercentPayload() {
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
        kind: "percent",
        name: "Progress",
        settings: {},
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
      {
        item_id: "t1",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { percent: 40 },
      },
      {
        item_id: "t2",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { percent: 80 },
      },
    ],
    dependencies: [],
    views: [],
  } as never;
}

describe("BoardTable collapsed-group rollup", () => {
  it("shows the group's averaged percent bar when the group is collapsed", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardTable payload={groupPercentPayload()} selectedViewId="v1" />
      </QueryClientProvider>,
    );
    // Expanded by default → items visible, no group Average row.
    expect(screen.getByText("Task One")).toBeInTheDocument();
    expect(screen.queryByText("Average")).not.toBeInTheDocument();

    // Collapse the group.
    fireEvent.click(screen.getByRole("button", { name: "Collapse Group 1" }));

    // Items hidden; the group's average bar (avg of 40 and 80 = 60) shows.
    expect(screen.queryByText("Task One")).not.toBeInTheDocument();
    expect(screen.getByText("Average")).toBeInTheDocument();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "60",
    );
    // GroupRollupRow's frozen label cell keeps the permanent Name-column
    // right-edge hairline (it's a `.name-freeze-edge` element already
    // covered above, but exercised here specifically via the "Average" row).
    const rollupNameCell = screen.getByText("Average");
    for (const cls of NAME_FREEZE_RULE.split(" ")) {
      expect(rollupNameCell.className).toContain(cls);
    }
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
      {
        item_id: "t1",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { n: 10 },
      },
      {
        item_id: "t2",
        column_id: "c1",
        org_id: "o1",
        board_id: "b1",
        value: { n: 5 },
      },
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

// Two groups sharing one numbers column: g1 items sum to 3, g2 items to 7,
// the whole board to 10 — distinct per-surface totals so a test can tell a
// group-scoped summary from the board-wide one.
function twoGroupSummaryPayload(settings: Record<string, unknown>) {
  const item = (id: string, gid: string, name: string, position: number) => ({
    id,
    board_id: "b1",
    org_id: "o1",
    group_id: gid,
    parent_id: null,
    name,
    position,
  });
  const cell = (itemId: string, n: number) => ({
    item_id: itemId,
    column_id: "c1",
    org_id: "o1",
    board_id: "b1",
    value: { n },
  });
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
      {
        id: "g2",
        board_id: "b1",
        org_id: "o1",
        name: "Group 2",
        color: "#00c875",
        position: 1,
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
      item("a1", "g1", "Alpha 1", 0),
      item("a2", "g1", "Alpha 2", 1),
      item("b1i", "g2", "Beta 1", 0),
      item("b2i", "g2", "Beta 2", 1),
    ],
    cellValues: [cell("a1", 1), cell("a2", 2), cell("b1i", 3), cell("b2i", 4)],
    dependencies: [],
    views: [],
  } as never;
}

function renderTwoGroupSummary(settings: Record<string, unknown>) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable
        payload={twoGroupSummaryPayload(settings)}
        selectedViewId="v1"
      />
    </QueryClientProvider>,
  );
}

describe("BoardTable per-group summary rows", () => {
  it("shows a summary row per group with group-scoped values once a column has an aggregation", () => {
    renderTwoGroupSummary({ summary_aggregation: "sum" });
    expect(screen.getByTestId("group-summary-g1")).toHaveTextContent("3");
    expect(screen.getByTestId("group-summary-g2")).toHaveTextContent("7");
    // board footer still totals everything
    expect(screen.getByTestId("board-summary-footer")).toHaveTextContent("10");
  });

  it("renders no group summary rows when no column has an aggregation", () => {
    renderTwoGroupSummary({});
    expect(screen.queryByTestId("group-summary-g1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-summary-g2")).not.toBeInTheDocument();
    // board footer affordance unchanged
    expect(screen.getByTestId("board-summary-footer")).toBeInTheDocument();
  });
});

describe("BoardTable collapsed-group summary", () => {
  it("collapsed group shows the assigned summary instead of the legacy rollup", () => {
    renderTwoGroupSummary({ summary_aggregation: "sum" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse Group 1" }));
    // group-scoped subtotal survives the collapse…
    expect(screen.getByTestId("group-summary-g1")).toHaveTextContent("3");
    // …and the hardcoded GroupRollupRow strip (labeled "Average") is gone.
    expect(screen.queryByText("Average")).not.toBeInTheDocument();
    // The collapsed group's SummaryRow frozen name track also carries the
    // permanent Name-column right-edge hairline.
    const nameTrack = screen.getByTestId("group-summary-g1")
      .firstElementChild as HTMLElement;
    for (const cls of NAME_FREEZE_RULE.split(" ")) {
      expect(nameTrack.className).toContain(cls);
    }
  });

  it("collapsed group without any assigned summary keeps the legacy rollup strip", () => {
    renderTwoGroupSummary({});
    fireEvent.click(screen.getByRole("button", { name: "Collapse Group 1" }));
    expect(screen.getByText("Average")).toBeInTheDocument();
    expect(screen.queryByTestId("group-summary-g1")).not.toBeInTheDocument();
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

function renderFooterWithPresence(presence: BoardPresenceContextValue) {
  // PresenceRing/usePresenceFocus now read the presence focus store (per-target
  // selectors), not the context — seed it from the same fixture. The context
  // provider stays for the roster/avatar-bar consumers.
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
        <BoardTable payload={footerPayload({})} selectedViewId="v1" />
      </BoardPresenceProvider>
    </QueryClientProvider>,
  );
}

describe("BoardTable cell presence ring (8a)", () => {
  afterEach(() => usePresenceFocusStore.getState().reset());

  it("shows an editing indicator on a cell another user is focused on", () => {
    // footerPayload has item t1 / column c1 → target cell:t1:c1
    const focusMap = new Map([["cell:t1:c1", [occupant({ name: "Sam" })]]]);
    renderFooterWithPresence(presenceValue(focusMap));
    expect(screen.getByLabelText(/Sam is editing/i)).toBeInTheDocument();
  });

  it("does not show a ring for the local (self) user's own focus", () => {
    const focusMap = new Map([
      ["cell:t1:c1", [occupant({ userId: "self", isSelf: true })]],
    ]);
    renderFooterWithPresence(presenceValue(focusMap, "self"));
    expect(screen.queryByLabelText(/is editing/i)).not.toBeInTheDocument();
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
      {
        id: "g1",
        board_id: "b1",
        org_id: "o1",
        name: "Group 1",
        color: "#0073ea",
        position: 0,
      },
      {
        id: "g2",
        board_id: "b1",
        org_id: "o1",
        name: "Group 2",
        color: "#00c875",
        position: 1,
      },
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

  it("gives every frozen Name-column element the permanent right-edge hairline (BoardColumnHeader + item NameCells)", () => {
    renderMany(1);
    const cells = document.querySelectorAll(".name-freeze-edge");
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      for (const cls of NAME_FREEZE_RULE.split(" ")) {
        expect(cell.className).toContain(cls);
      }
    }
  });

  it("flips data-scrolledx on the scroll container during horizontal scroll", () => {
    renderMany(1);
    const scroller = screen.getByTestId("board-scroll");
    expect(scroller).toHaveAttribute("data-scrolledx", "false");
    scroller.scrollLeft = 120;
    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute("data-scrolledx", "true");
  });

  it("keeps every frozen name cell opaque when a row is selected (no horizontal-scroll bleed)", () => {
    const { container } = renderNested();
    // Select the top-level Epic row.
    act(() => {
      useBoardSelection.getState().setOrderedIds(["p1"]);
      useBoardSelection.getState().toggle("p1");
    });
    // The Name column is `sticky left-0`, so the other columns scroll UNDER it;
    // its background must stay opaque. A translucent selection wash
    // (bg-primary/[0.08]) on a frozen cell would let scrolled content bleed
    // through — the reskin regression this guards against.
    const frozen = container.querySelectorAll<HTMLElement>(".sticky.left-0");
    expect(frozen.length).toBeGreaterThan(0);
    frozen.forEach((el) => {
      expect(el.className).not.toContain("bg-primary/[0.08]");
    });
    useBoardSelection.getState().clear();
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

// ── One board column header ─────────────────────────────────────────────────
// Columns are board-scoped. The header is rendered ONCE, as the first child of
// the scroller's content, so it is there for an empty group, a collapsed group
// and a board with no groups at all. Fixture: 3 board columns, two groups, and
// the SECOND group is EMPTY (no items).
function payloadWithColumns() {
  const col = (id: string, name: string, kind = "text", position = 0) => ({
    id,
    board_id: "b1",
    org_id: "o1",
    kind,
    name,
    settings: {},
    position,
    width: null,
  });
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
      {
        id: "g2",
        board_id: "b1",
        org_id: "o1",
        name: "Group 2",
        color: "#e2445c",
        position: 1,
      },
    ],
    columns: [
      col("c_status", "Status", "status", 0),
      col("c_owner", "Owner", "people", 1),
      col("c_date", "Due Date", "date", 2),
    ],
    items: [
      {
        id: "i1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        name: "Item 1",
        position: 0,
        parent_id: null,
      },
    ],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderBoardWithColumns() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={payloadWithColumns()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

describe("BoardTable single column header", () => {
  it("renders each column header exactly once for a board with several groups", () => {
    renderBoardWithColumns();
    expect(screen.getAllByText("Status")).toHaveLength(1);
    expect(screen.getAllByText("Owner")).toHaveLength(1);
    expect(screen.getAllByText("Due Date")).toHaveLength(1);
  });

  it("is the first child of the scroller's content and sticks to the top", () => {
    renderBoardWithColumns();
    const header = screen.getByTestId("board-column-header");
    const content = screen.getByTestId("board-scroll").firstElementChild;
    expect(content?.firstElementChild).toBe(header);
    const classes = header.className.split(/\s+/);
    expect(classes).toContain("sticky");
    expect(classes).toContain("top-0");
    expect(classes).toContain("z-40");
  });

  it("still shows the board's columns above an empty group", () => {
    renderBoardWithColumns();
    expect(screen.getByTestId("group-header-g2")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("board-column-header")).getByText("Owner"),
    ).toBeInTheDocument();
  });

  it("shows the columns on a board that has no groups yet", () => {
    const base = payloadWithColumns() as unknown as Record<string, unknown>;
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable
          payload={{ ...base, groups: [], items: [] } as never}
          selectedViewId="v1"
        />
      </QueryClientProvider>,
    );
    expect(
      within(screen.getByTestId("board-column-header")).getByText("Status"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This board has no groups yet."),
    ).toBeInTheDocument();
  });

  it("renders one Add-column control, one Name resize handle and one resize handle per column", () => {
    renderBoardWithColumns();
    expect(screen.getAllByRole("button", { name: /add column/i })).toHaveLength(
      1,
    );
    expect(
      screen.getAllByRole("separator", { name: /^Resize Name column/i }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("separator", { name: "Resize Status" }),
    ).toHaveLength(1);
  });

  it("keeps the column header when a group is collapsed", () => {
    renderBoardWithColumns();
    fireEvent.click(screen.getByRole("button", { name: /Collapse Group 2/i }));
    expect(screen.getAllByText("Status")).toHaveLength(1);
  });

  it("marks the header's Item cell as the freeze edge", () => {
    renderBoardWithColumns();
    const itemCell = screen.getByTestId("board-column-header")
      .firstElementChild as HTMLElement;
    expect(itemCell.className).toContain("name-freeze-edge");
    for (const cls of NAME_FREEZE_RULE.split(" ")) {
      expect(itemCell.className).toContain(cls);
    }
    expect(within(itemCell).getByText("Item")).toBeInTheDocument();
  });
});

function progressPayload() {
  const base = payloadWithColumns() as unknown as {
    columns: { id: string; settings: unknown }[];
  };
  const mkItem = (id: string, name: string, position: number) => ({
    id,
    board_id: "b1",
    org_id: "o1",
    group_id: "g1",
    name,
    position,
    parent_id: null,
  });
  return {
    ...base,
    columns: base.columns.map((c) =>
      c.id === "c_status"
        ? {
            ...c,
            settings: {
              options: [
                { id: "o_done", label: "Done", color: "#00c875" },
                { id: "o_wip", label: "Working on it", color: "#fdab3d" },
              ],
            },
          }
        : c,
    ),
    items: [mkItem("i1", "Item 1", 0), mkItem("i2", "Item 2", 1)],
    cellValues: [
      { item_id: "i1", column_id: "c_status", value: { optionId: "o_done" } },
      { item_id: "i2", column_id: "c_status", value: { optionId: "o_wip" } },
    ],
  } as never;
}

describe("BoardTable group row", () => {
  it("shows the title as the user typed it, with no index number", () => {
    renderBoardWithColumns();
    const title = within(screen.getByTestId("group-header-g1")).getByRole(
      "button",
      { name: "Group 1" },
    );
    expect(title.textContent).toBe("Group 1");
  });

  it("sticks under the column header", () => {
    renderBoardWithColumns();
    const classes = screen
      .getByTestId("group-header-g1")
      .className.split(/\s+/);
    expect(classes).toContain("sticky");
    expect(classes).toContain("top-[30px]");
    expect(classes).toContain("z-30");
  });

  it("holds its content in a block pinned to the visible width of the scroller", () => {
    renderBoardWithColumns();
    const inner = screen.getByTestId("group-header-g1")
      .firstElementChild as HTMLElement;
    const classes = inner.className.split(/\s+/);
    expect(classes).toContain("sticky");
    expect(classes).toContain("left-0");
    expect(classes).toContain("w-[var(--board-viewport-w,100%)]");
  });

  it("publishes the scroller's visible width for that block", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 900;
      },
    });
    try {
      renderBoard();
      expect(
        screen
          .getByTestId("board-scroll")
          .style.getPropertyValue("--board-viewport-w"),
      ).toBe("900px");
    } finally {
      // jsdom defines clientWidth on Element.prototype; drop the override.
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)
        .clientWidth;
    }
  });

  it("shows the item count", () => {
    renderBoardWithColumns();
    expect(
      within(screen.getByTestId("group-header-g1")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("group-header-g2")).getByText("0"),
    ).toBeInTheDocument();
  });

  it("shows a progress meter from the board's done rule", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable payload={progressPayload()} selectedViewId="v1" />
      </QueryClientProvider>,
    );
    const g1 = within(screen.getByTestId("group-header-g1"));
    expect(g1.getByText("50% done")).toBeInTheDocument();
    expect(g1.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    // An empty group has nothing to measure.
    expect(
      within(screen.getByTestId("group-header-g2")).queryByRole("progressbar"),
    ).toBeNull();
  });

  it("shows no progress meter on a board without a status column", () => {
    renderTwoItems();
    expect(
      within(screen.getByTestId("group-header-g1")).queryByRole("progressbar"),
    ).toBeNull();
  });
});

describe("BoardTable column reorder", () => {
  it("renders one reorder grip per data column, in the single header", () => {
    renderBoardWithColumns();
    // Name/Created cells get no grip.
    expect(
      screen.getAllByRole("button", { name: "Reorder Status column" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Reorder Owner column" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Reorder Name/ })).toBeNull();
  });

  it("disables Move left on the first data column and Move right on the last", () => {
    renderBoardWithColumns();
    fireEvent.click(screen.getByLabelText("Status column menu"));
    expect(
      screen.getByText("Move left").closest("[role=menuitem]"),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Move right").closest("[role=menuitem]"),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("BoardTable column reorder (pure position math)", () => {
  it("computes a column reorder position among board columns", () => {
    const cols = [
      { id: "c_status", position: 0 },
      { id: "c_owner", position: 1 },
      { id: "c_date", position: 2 },
    ];
    // drag Due Date before Status → strictly less than 0
    expect(reorderPosition(cols, "c_date", "c_status")!).toBeLessThan(0);
    // self-drop is a no-op
    expect(reorderPosition(cols, "c_owner", "c_owner")).toBeNull();
  });
});

// ── TOUCH Batch-2 (iPad) ──────────────────────────────────────────────────
// jsdom can't simulate touch-drag physics, so we assert sensor *config* and
// coarse-pointer *class presence* (the `(pointer: coarse)` media query only
// resolves in a real browser), mirroring ui/button.touch.test.tsx.

describe("BoardTable touch reorder sensors", () => {
  it("gives the board, column-header and subitem DndContexts the shared touch-aware sensors", () => {
    // `[]` is a valid dnd-kit sensors value and a unique identity to look for.
    const sentinel: unknown[] = [];
    sensorsSentinel = sentinel;
    renderNested();
    fireEvent.click(screen.getByRole("button", { name: "Expand Epic" }));

    const latest = (match: (id: string) => boolean) =>
      dndContextProps.filter((c) => c.id && match(c.id)).at(-1);
    for (const [label, ctx] of [
      ["board-dnd", latest((id) => id === "board-dnd")],
      ["board-columns", latest((id) => id === "board-columns")],
      ["subitems-*", latest((id) => id.startsWith("subitems-"))],
    ] as const) {
      expect(ctx, `${label} context mounted`).toBeDefined();
      expect(ctx?.sensors, `${label} sensors`).toBe(sentinel);
    }
  });
});

// ── SSR-stable dnd ids ────────────────────────────────────────────────────
// dnd-kit's auto-generated `DndDescribedBy-N` ids come from a module-global
// counter that diverges between server render and client hydration (dev
// StrictMode double-invokes useMemo, consuming two counter slots per context
// on the client) → hydration mismatch on aria-describedby. Every DndContext
// must therefore pass an explicit deterministic `id`, which bypasses the
// counter entirely. Regression: the column-header reorder context shipped
// without one.

describe("BoardTable deterministic dnd ids", () => {
  it("gives the column reorder handle a fixed aria-describedby, not one from the global counter", () => {
    const qc = new QueryClient();
    const payload = {
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
      items: [],
      cellValues: [],
      dependencies: [],
      views: [],
    } as never;
    render(
      <QueryClientProvider client={qc}>
        <BoardTable payload={payload} selectedViewId="v1" />
      </QueryClientProvider>,
    );
    const handle = screen.getByRole("button", { name: "Reorder Est column" });
    expect(handle.getAttribute("aria-describedby")).toBe("board-columns");
  });
});

describe("BoardTable touch targets (coarse pointer)", () => {
  it("makes the group menu and group drag handle always-visible + 44px on coarse", () => {
    renderBoard();
    const groupMenu = screen.getByRole("button", {
      name: "Group 1 group menu",
    });
    const groupHandle = screen.getByRole("button", { name: "Reorder Group 1" });
    for (const el of [groupMenu, groupHandle]) {
      expect(el.className).toContain("pointer-coarse:opacity-100");
      expect(el.className).toContain("pointer-coarse:size-11");
    }
  });

  it("makes item row controls (menu, drag handle, open-panel) always-visible + 44px on coarse", () => {
    renderTwoItems();
    const handle = screen.getByRole("button", { name: "Reorder Task One" });
    const open = screen.getByRole("button", { name: "Open Task One" });
    const menu = screen.getByRole("button", { name: "Task One menu" });
    for (const el of [handle, open, menu]) {
      expect(el.className).toContain("pointer-coarse:opacity-100");
      expect(el.className).toContain("pointer-coarse:size-11");
    }
  });

  it("makes the add-subitem button always-visible + 44px on coarse", () => {
    renderChildless();
    const addBtn = screen.getByRole("button", {
      name: "Add subitem to Task One",
    });
    expect(addBtn.className).toContain("pointer-coarse:opacity-100");
    expect(addBtn.className).toContain("pointer-coarse:size-11");
  });

  it("makes the subitem drag handle always-visible + 44px on coarse", () => {
    renderNested();
    fireEvent.click(screen.getByRole("button", { name: /Expand Epic/i }));
    const subHandle = screen.getByRole("button", { name: "Reorder Design" });
    expect(subHandle.className).toContain("pointer-coarse:opacity-100");
    expect(subHandle.className).toContain("pointer-coarse:size-11");
  });
});

describe("BoardTable saved arrangement", () => {
  function renderWithPrefs(collapsedGroupIds: string[]) {
    const qc = new QueryClient();
    return render(
      <QueryClientProvider client={qc}>
        <BoardViewPrefsProvider
          boardId="b1"
          initial={{ ...EMPTY_BOARD_VIEW_PREFS, collapsedGroupIds }}
        >
          <BoardTable payload={payloadFixture()} selectedViewId="v1" />
        </BoardViewPrefsProvider>
      </QueryClientProvider>,
    );
  }

  // The chevron's aria-label flips with the state: "Expand <group>" while
  // collapsed, "Collapse <group>" while expanded (see GroupHeaderRow).
  it("renders a group collapsed when the saved arrangement says so", () => {
    renderWithPrefs(["g1"]);
    expect(screen.getByLabelText("Expand Group 1")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("renders the group expanded when nothing is saved", () => {
    renderWithPrefs([]);
    expect(screen.getByLabelText("Collapse Group 1")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("toggles a saved-collapsed group back open on click", () => {
    renderWithPrefs(["g1"]);
    fireEvent.click(screen.getByLabelText("Expand Group 1"));
    expect(screen.getByLabelText("Collapse Group 1")).toBeInTheDocument();
  });
});

describe("BoardTable density", () => {
  it("marks the scroller as the dense board table", () => {
    // globals.css scopes the 12.5px cell size to this attribute.
    renderBoard();
    expect(screen.getByTestId("board-scroll")).toHaveAttribute(
      "data-board-table",
    );
  });

  it("pads scrolled-to focus below the sticky header + group row and Board Total", () => {
    // Sticky column header 30 + pinned group row 30 = 60 (44 + 44 = 88 on
    // coarse); sticky Board Total min-h 38. Without scroll padding, keyboard
    // focus can land hidden under them.
    renderBoard();
    const classes = screen.getByTestId("board-scroll").className.split(/\s+/);
    expect(classes).toContain("scroll-pt-[60px]");
    expect(classes).toContain("pointer-coarse:scroll-pt-[88px]");
    expect(classes).toContain("scroll-pb-[38px]");
  });

  it("renders item rows at 28px on a fine pointer", () => {
    renderTwoItems();
    const row = screen
      .getByRole("button", { name: "Reorder Task One" })
      .closest("[data-intel-rule='cell']") as HTMLElement;
    expect(row.style.height).toBe("28px");
  });

  it("pads value cells to 8px", () => {
    renderBoardWithColumns();
    const cell = screen.getByLabelText("Item 1 Status");
    expect(cell.className).toContain("px-2");
    expect(cell.className).not.toContain("px-4");
  });
});

describe("BoardTable column fit", () => {
  // Status is the first value column: the header grid's second track.
  const statusTrack = () =>
    (
      screen.getByTestId("board-column-header").style.gridTemplateColumns || ""
    ).split(" ")[1];
  async function dragStatusWider() {
    const handle = screen.getByRole("separator", { name: "Resize Status" });
    const before = statusTrack();
    fireEvent.pointerDown(handle, { clientX: 100 });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 340 }));
    });
    await waitFor(() => expect(statusTrack()).not.toBe(before));
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    return before;
  }

  it("double-click drops the live drag width so the track returns to the fitted value", async () => {
    resizeColumn.mockResolvedValue({ ok: true, data: undefined });
    renderBoardWithColumns();
    const before = await dragStatusWider();
    resizeColumn.mockClear();
    fireEvent.doubleClick(
      screen.getByRole("separator", { name: "Resize Status" }),
    );
    await waitFor(() => expect(statusTrack()).toBe(before));
    expect(resizeColumn).toHaveBeenCalledWith({
      columnId: "c_status",
      width: null,
    });
  });

  it("Fit all columns drops live drag widths too", async () => {
    resizeColumn.mockResolvedValue({ ok: true, data: undefined });
    resetColumnWidths.mockResolvedValue({ ok: true, data: undefined });
    renderBoardWithColumns();
    const before = await dragStatusWider();
    fireEvent.click(screen.getByTestId("board-header-fit"));
    await waitFor(() => expect(statusTrack()).toBe(before));
    expect(resetColumnWidths).toHaveBeenCalledTimes(1);
  });

  it("double-clicking a column's resize handle clears its saved width", async () => {
    resizeColumn.mockResolvedValue({ ok: true, data: undefined });
    renderBoardWithColumns();
    fireEvent.doubleClick(
      screen.getByRole("separator", { name: "Resize Status" }),
    );
    await waitFor(() =>
      expect(resizeColumn).toHaveBeenCalledWith({
        columnId: "c_status",
        width: null,
      }),
    );
  });

  it("Fit all columns clears the board's widths through one action", async () => {
    resetColumnWidths.mockResolvedValue({ ok: true, data: undefined });
    renderBoardWithColumns();
    fireEvent.click(screen.getByTestId("board-header-fit"));
    await waitFor(() =>
      expect(resetColumnWidths).toHaveBeenCalledWith({ boardId: "b1" }),
    );
    expect(resetColumnWidths).toHaveBeenCalledTimes(1);
    expect(resizeColumn).not.toHaveBeenCalled();
  });

  it("does not hand viewers the Fit all columns handler", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardTable
          payload={payloadWithColumns()}
          selectedViewId="v1"
          access="viewer"
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("board-header-fit")).toBeNull();
  });
});

describe("BoardTable centered value columns", () => {
  it("centers a value cell", () => {
    renderBoardWithColumns();
    const classes = screen
      .getByLabelText("Item 1 Status")
      .className.split(/\s+/);
    expect(classes).toContain("justify-center-safe");
    expect(classes).toContain("text-center");
    expect(classes).toContain("*:justify-center-safe");
  });

  it("centers the Created cells", () => {
    renderBoardWithColumns();
    // The fixture item has no creator, so Created by reads "Unknown".
    const createdBy = screen.getByText("Unknown").parentElement as HTMLElement;
    expect(createdBy.className.split(/\s+/)).toContain("justify-center-safe");
  });

  it("leaves the Name column left-aligned", () => {
    renderBoardWithColumns();
    const classes = screen.getByLabelText("Item 1 name").className.split(/\s+/);
    expect(classes).not.toContain("justify-center");
    expect(classes).not.toContain("text-center");
  });

  it("centers the Created headers", () => {
    renderBoardWithColumns();
    const header = screen.getByText("Created by").parentElement as HTMLElement;
    expect(header.className.split(/\s+/)).toContain("justify-center");
  });
});
