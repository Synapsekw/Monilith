import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MeasuringStrategy } from "@dnd-kit/core";
import type { DndContextProps, DragEndEvent } from "@dnd-kit/core";
import type { SharedBoardEntry } from "@/lib/boards/queries";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { reorderBoard } from "@/lib/boards/actions";
import { BoardsNav } from "./BoardsNav";
import { BoardFolderRow } from "./BoardFolderRow";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";
import { useUIStore } from "@/stores/ui";
import { moveBoardToFolder } from "@/lib/boards/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";

const mockUseParams = vi.fn(() => ({}) as Record<string, string>);

// Hoisted so the SAME spies are handed to every `useRouter()` call. A factory
// that minted a fresh `{ push, refresh }` per call could never observe a stray
// `router.refresh()` — which is exactly the gotcha-09 regression shape (a nav
// toggle that quietly re-runs every query in the page).
const { routerPush, routerRefresh } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
  usePathname: () => "/",
  useParams: () => mockUseParams(),
  useSearchParams: () => new URLSearchParams(),
}));

// The folder mutations are the only server calls this nav makes. Mocking the
// whole module (not just `moveBoardToFolder`) keeps NewFolderDialog's
// `createFolder` import resolvable.
vi.mock("@/lib/boards/folders/actions", () => ({
  moveBoardToFolder: vi.fn(async () => ({ ok: true, data: undefined })),
  createFolder: vi.fn(async () => ({ ok: true, data: undefined })),
}));

// The dropdown has already closed by the time a move fails, so the toast IS
// the failure surface — assert on it rather than on sonner's DOM.
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationError: vi.fn(),
  showMutationSuccess: vi.fn(),
  showUndoToast: vi.fn(),
}));

vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(() => false),
}));

// Reorder persists through the board actions module; only that one export is
// swapped so BoardItemMenu's rename/duplicate/archive imports stay real.
vi.mock("@/lib/boards/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/boards/actions")>();
  return {
    ...actual,
    reorderBoard: vi.fn(async () => ({ ok: true, data: undefined })),
  };
});

// jsdom gives every node a 0x0 rect, so @dnd-kit's collision detection can
// never resolve a real pointer drag here. Wrap DndContext to capture the very
// handler the component installs — the drop OUTCOMES (file vs. reorder) are
// then exercised for real, against the real props.
const dnd = vi.hoisted(() => ({
  props: null as DndContextProps | null,
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    DndContext: (props: DndContextProps) => {
      dnd.props = props;
      return createElement(actual.DndContext, props);
    },
  };
});

/**
 * The row element for a board inside the mounted drag tree. Rows are located by
 * their focus-anchor attribute because every owned row's menu shares one
 * accessible name — a positional index drifts onto a folder-nested row.
 */
function sortableRow(boardId: string): HTMLElement {
  const row = screen
    .getByTestId("boards-nav-sortable")
    .querySelector<HTMLElement>(`[data-board-row="${boardId}"]`);
  if (!row) throw new Error(`No draggable row for board ${boardId}`);
  return row;
}

/** Fire the real handler the mounted DndContext installed. */
function drop(activeId: string, overId: string | null) {
  dnd.props?.onDragEnd?.({
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
  } as unknown as DragEndEvent);
}

vi.mock("@/lib/dnd/sensors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dnd/sensors")>();
  return { useTouchAwareSensors: vi.fn(actual.useTouchAwareSensors) };
});

// File-level so every describe gets a clean slate regardless of block order —
// scoping these to one describe only worked while that block happened to run
// last.
beforeEach(() => {
  mockUseParams.mockReturnValue({});
  vi.mocked(useCoarsePointer).mockReturnValue(false);
  vi.mocked(useTouchAwareSensors).mockClear();
  routerPush.mockClear();
  routerRefresh.mockClear();
  vi.mocked(moveBoardToFolder).mockClear();
  vi.mocked(moveBoardToFolder).mockResolvedValue({ ok: true, data: undefined });
  vi.mocked(showMutationError).mockClear();
  vi.mocked(reorderBoard).mockClear();
  vi.mocked(reorderBoard).mockResolvedValue({ ok: true, data: undefined });
  dnd.props = null;
  // Folder open/closed state is the persisted `collapsedSections` map shared
  // with NavSection — reset it so one test's toggle can't leak into the next.
  useUIStore.setState({ collapsedSections: {} });
});

describe("BoardsNav", () => {
  it("shows 'No boards yet' when no boards are provided", () => {
    render(<BoardsNav boards={[]} sharedBoards={[]} />);

    expect(screen.getByText("No boards yet")).toBeInTheDocument();
  });

  it("renders a board name as a link to /boards/<id>", () => {
    render(
      <BoardsNav
        boards={[
          {
            id: "board-123",
            name: "My Board",
            workspace_id: "w1",
            position: 0,
            shared_out: false,
          },
        ]}
        sharedBoards={[]}
      />,
    );

    const link = screen.getByRole("link", { name: "My Board" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/boards/board-123");
  });

  it("marks the board matching the route param as active", () => {
    mockUseParams.mockReturnValue({ boardId: "board-123" });
    render(
      <BoardsNav
        boards={[
          {
            id: "board-123",
            name: "Active Board",
            workspace_id: "w1",
            position: 0,
            shared_out: false,
          },
          {
            id: "board-456",
            name: "Other Board",
            workspace_id: "w1",
            position: 1,
            shared_out: false,
          },
        ]}
        sharedBoards={[]}
      />,
    );

    expect(screen.getByRole("link", { name: "Active Board" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Other Board" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("collapsed: renders each board as an initial with the board name as its accessible label", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          collapsed
          boards={[
            {
              id: "b1",
              name: "Sprint backlog",
              workspace_id: "w1",
              position: 0,
              shared_out: false,
            },
          ]}
          sharedBoards={[]}
          activeWorkspaceId="w1"
        />
      </TooltipProvider>,
    );

    const link = screen.getByRole("link", { name: "Sprint backlog" });
    expect(link).toHaveAttribute("href", "/boards/b1");
    expect(link).toHaveTextContent("S");
    expect(screen.queryByText("Boards")).not.toBeInTheDocument();
  });

  it("collapsed + coarse: shows the Boards header + board name as visible captions (gotcha-47)", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(true);
    render(
      <TooltipProvider>
        <BoardsNav
          collapsed
          boards={[
            {
              id: "b1",
              name: "Marketing",
              workspace_id: "w1",
              position: 0,
              shared_out: false,
            },
          ]}
          sharedBoards={[]}
          activeWorkspaceId="w1"
        />
      </TooltipProvider>,
    );
    // Header caption now visible (was tooltip-only).
    expect(
      screen.getByText("Boards", { selector: "span" }),
    ).toBeInTheDocument();
    // The letter tile keeps its initial AND gains the full name as a caption.
    const tile = screen.getByRole("link", { name: "Marketing" });
    expect(tile).toHaveTextContent("M");
    expect(tile).toHaveTextContent("Marketing");
    expect(tile.className).toContain("pointer-coarse:min-h-11");
  });

  it("collapsed + fine: stays icon/initial-only, no name caption", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(false);
    render(
      <TooltipProvider>
        <BoardsNav
          collapsed
          boards={[
            {
              id: "b1",
              name: "Marketing",
              workspace_id: "w1",
              position: 0,
              shared_out: false,
            },
          ]}
          sharedBoards={[]}
          activeWorkspaceId="w1"
        />
      </TooltipProvider>,
    );
    expect(
      screen.queryByText("Boards", { selector: "span" }),
    ).not.toBeInTheDocument();
    const tile = screen.getByRole("link", { name: "Marketing" });
    // Only the initial is on-screen; full name lives in aria-label/tooltip.
    expect(tile).toHaveTextContent("M");
    expect(
      screen.queryByText("Marketing", { selector: "span" }),
    ).not.toBeInTheDocument();
  });

  it("collapsed + coarse: shared-board tiles also gain a visible name caption", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(true);
    render(
      <TooltipProvider>
        <BoardsNav
          collapsed
          boards={[]}
          sharedBoards={[
            {
              id: "s1",
              name: "Roadmap",
              position: 0,
              owner_name: "Dana",
              access_level: "viewer",
            },
          ]}
          activeWorkspaceId="w1"
        />
      </TooltipProvider>,
    );
    const tile = screen.getByRole("link", { name: "Roadmap" });
    expect(tile).toHaveTextContent("R");
    expect(tile).toHaveTextContent("Roadmap");
  });

  it("renders boards with a shared indicator and a Shared with me section", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[
            {
              id: "b1",
              name: "Roadmap",
              workspace_id: "w",
              position: 0,
              shared_out: true,
            },
            {
              id: "b2",
              name: "Personal",
              workspace_id: "w",
              position: 1,
              shared_out: false,
            },
          ]}
          sharedBoards={[
            {
              id: "b3",
              name: "Q3 Launch",
              position: 0,
              owner_name: "Dana",
              access_level: "viewer",
            },
            {
              id: "b4",
              name: "Editable Plan",
              position: 1,
              owner_name: "Mo",
              access_level: "editor",
            },
          ]}
          activeWorkspaceId="w"
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("Shared with me")).toBeInTheDocument();
    expect(screen.getByText("Q3 Launch")).toBeInTheDocument();
    expect(screen.getByLabelText("Shared with others")).toBeInTheDocument();

    // Viewer-access shared boards get a subtle read-only hint; editor ones don't.
    const viewerHints = screen.getAllByLabelText("View only");
    expect(viewerHints).toHaveLength(1);
    expect(screen.getByText("Q3 Launch").parentElement).toContainElement(
      viewerHints[0],
    );
  });

  it("right-aligns the owned shared-out icon outside the board name link", () => {
    render(
      <BoardsNav
        boards={[
          {
            id: "b1",
            name: "Roadmap",
            workspace_id: "w",
            position: 0,
            shared_out: true,
          },
        ]}
        sharedBoards={[]}
        activeWorkspaceId="w"
      />,
    );
    // The name link is exactly "Roadmap" — the share icon is no longer nested
    // inside it (which would fold its label into the link's accessible name).
    const link = screen.getByRole("link", { name: "Roadmap" });
    const sharedIcon = screen.getByLabelText("Shared with others");
    expect(link).not.toContainElement(sharedIcon);
  });

  it("shows who shared a board via a hover icon, not a 'from' text line", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[]}
          sharedBoards={[
            {
              id: "s1",
              name: "Q3 Launch",
              position: 0,
              owner_name: "Dana",
              access_level: "editor",
            },
          ]}
          activeWorkspaceId="w"
        />
      </TooltipProvider>,
    );
    // No redundant second line naming the owner…
    expect(screen.queryByText(/from Dana/)).not.toBeInTheDocument();
    // …instead an icon whose accessible label / tooltip names the sharer.
    expect(screen.getByLabelText("Shared by Dana")).toBeInTheDocument();
  });
});

describe("BoardsNav drag-reorder", () => {
  const owned = [
    {
      id: "b1",
      name: "Alpha",
      workspace_id: "w1",
      position: 0,
      shared_out: false,
    },
    {
      id: "b2",
      name: "Beta",
      workspace_id: "w1",
      position: 1,
      shared_out: false,
    },
  ];

  it("renders a plain, navigable board list with no synchronous DnD context", () => {
    render(<BoardsNav boards={owned} sharedBoards={[]} />);
    // Board links paint immediately on first render…
    expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument();
    // …but @dnd-kit is a lazy next/dynamic(ssr:false) chunk, so the sortable
    // wrapper (and its reorder handles) are absent until a pointer/focus
    // interaction mounts it — keeping the DnD stack off the shell bundle.
    expect(screen.queryByTestId("boards-nav-sortable")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reorder Alpha" }),
    ).not.toBeInTheDocument();
  });

  it("lazily mounts the sortable variant (handles + shared sensors) on first pointer interaction", async () => {
    render(<BoardsNav boards={owned} sharedBoards={[]} />);
    // Pointer enters the board list → the drag-enabled variant is dynamically
    // imported and mounted, so the first reorder still works.
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));

    expect(
      await screen.findByRole("button", { name: "Reorder Alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reorder Beta" }),
    ).toBeInTheDocument();
    // Reorder uses the shared long-press-on-touch sensors, not a bespoke config.
    expect(useTouchAwareSensors).toHaveBeenCalled();
  });

  it("keeps keyboard focus on the board you tabbed to when the drag variant mounts", async () => {
    render(<BoardsNav boards={owned} sharedBoards={[]} />);

    // First Tab into the boards list lands on a board link…
    const link = screen.getByRole("link", { name: "Alpha" });
    link.focus();
    expect(document.activeElement).toBe(link);

    // …which arms the lazy drag-enabled list. Mounting it REPLACES the plain
    // rows, destroying the focused element — so it must hand focus back, or
    // the user's first Tab appears to do nothing and drops them on <body>.
    await screen.findByTestId("boards-nav-sortable");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("link", { name: "Alpha" }),
      ),
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("renders no reorder handles when collapsed", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          collapsed
          boards={owned}
          sharedBoards={[]}
          activeWorkspaceId="w1"
        />
      </TooltipProvider>,
    );
    expect(
      screen.queryByRole("button", { name: /^Reorder / }),
    ).not.toBeInTheDocument();
  });

  it("renders no reorder handles for shared boards", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[]}
          sharedBoards={[
            {
              id: "s1",
              name: "Theirs",
              position: 0,
              owner_name: "Dana",
              access_level: "editor",
            },
          ]}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("Theirs")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Reorder / }),
    ).not.toBeInTheDocument();
  });

  // The drag end → new float position is computed by the shared reorderPosition
  // helper; verify the math the sidebar relies on (mirrors BoardTable's
  // "pure position math" tests).
  it("computes a midpoint when dropping a board between two others", () => {
    const order = [
      { id: "b1", position: 0 },
      { id: "b2", position: 1 },
      { id: "b3", position: 2 },
    ];
    const pos = reorderPosition(order, "b3", "b2")!;
    expect(pos).toBeGreaterThan(0);
    expect(pos).toBeLessThan(1);
  });

  it("returns null for a no-op drop (board on itself)", () => {
    const order = [
      { id: "b1", position: 0 },
      { id: "b2", position: 1 },
    ];
    expect(reorderPosition(order, "b2", "b2")).toBeNull();
  });
});

describe("BoardsNav folders", () => {
  const ownedBoard = {
    id: "b1",
    name: "Website revamp",
    workspace_id: "w1",
    position: 0,
    shared_out: false,
  };
  const sharedBoard = {
    id: "s1",
    name: "Design tasks",
    position: 0,
    owner_name: "Ada",
    access_level: "editor" as const,
  };

  it("renders a folder containing both an owned and a shared board", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[sharedBoard]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[
            { boardId: "b1", folderId: "f1", position: 0 },
            { boardId: "s1", folderId: "f1", position: 1 },
          ]}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Acme Rebrand")).toBeInTheDocument();
    expect(screen.getByText("Website revamp")).toBeInTheDocument();
    expect(screen.getByText("Design tasks")).toBeInTheDocument();
    // Every shared board is filed, so the section heading is gone.
    expect(screen.queryByText("Shared with me")).not.toBeInTheDocument();
  });

  it("hides a folder whose boards are not visible in this workspace", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={[{ id: "f1", name: "Elsewhere", position: 0 }]}
          placements={[{ boardId: "b-other", folderId: "f1", position: 0 }]}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument();
    expect(screen.getByText("Website revamp")).toBeInTheDocument();
  });

  it("keeps 'Shared with me' for shared boards that are not filed", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[]}
          sharedBoards={[sharedBoard]}
          folders={[]}
          placements={[]}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Shared with me")).toBeInTheDocument();
    expect(screen.getByText("Design tasks")).toBeInTheDocument();
  });

  it("collapses a folder without a server round-trip", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[{ boardId: "b1", folderId: "f1", position: 0 }]}
        />
      </TooltipProvider>,
    );

    const toggle = screen.getByRole("button", {
      name: /Collapse Acme Rebrand/i,
    });
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: /Expand Acme Rebrand/i }),
    ).toBeInTheDocument();
    // Collapsing changes no server data, so it must not re-run the page's
    // queries (gotcha-09): client state only, zero round-trips.
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("leaves the collapsed rail flat — no folder chrome", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[{ boardId: "b1", folderId: "f1", position: 0 }]}
          collapsed
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText("Acme Rebrand")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Website revamp" }),
    ).toBeInTheDocument();
  });

  it("offers a 'Move to folder' entry on an owned board row", async () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[]}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Board actions" }));
    expect(await screen.findByText("Move to folder")).toBeInTheDocument();
  });

  it("offers a 'Move to folder' entry on a shared board row", async () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[]}
          sharedBoards={[sharedBoard]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[]}
        />
      </TooltipProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Board actions for Design tasks" }),
    );
    expect(await screen.findByText("Move to folder")).toBeInTheDocument();
  });

  it("keeps an unfiled owned row's menu open — a portaled focus is not a list interaction", async () => {
    render(
      <TooltipProvider>
        <BoardsNav boards={[ownedBoard]} sharedBoards={[]} folders={[]} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Board actions" }));
    expect(await screen.findByText("Rename")).toBeInTheDocument();
    // React sends portal events up the COMPONENT tree, so the menu's own focus
    // must not be mistaken for focus entering the board list and swap in the
    // lazy sortable variant — that would unmount the row mid-interaction.
    expect(screen.queryByTestId("boards-nav-sortable")).not.toBeInTheDocument();
  });

  it("keeps the shared-board row's owner and view-only markers alongside its menu", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[]}
          sharedBoards={[{ ...sharedBoard, access_level: "viewer" as const }]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[{ boardId: "s1", folderId: "f1", position: 0 }]}
        />
      </TooltipProvider>,
    );

    // Filing a shared board must never hide WHOSE board it is.
    expect(screen.getByLabelText("Shared by Ada")).toBeInTheDocument();
    expect(screen.getByLabelText("View only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Design tasks" })).toHaveAttribute(
      "href",
      "/boards/s1",
    );
    expect(
      screen.getByRole("button", { name: "Board actions for Design tasks" }),
    ).toBeInTheDocument();
  });
});

describe("BoardsNav folder moves", () => {
  const ownedBoard = {
    id: "b1",
    name: "Website revamp",
    workspace_id: "w1",
    position: 0,
    shared_out: false,
  };
  const sharedBoard = {
    id: "s1",
    name: "Design tasks",
    position: 0,
    owner_name: "Ada",
    access_level: "editor" as const,
  };
  const folders = [
    { id: "f1", name: "Acme Rebrand", position: 0 },
    { id: "f2", name: "Q3 Launch", position: 1 },
  ];

  /** Open a row menu, then its "Move to folder" submenu, and hand back the items. */
  async function openMoveSubmenu(triggerName: string) {
    fireEvent.click(screen.getByRole("button", { name: triggerName }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Move to folder/ }),
    );
    // The submenu content is portaled; wait for its first entry to land.
    await screen.findByRole("menuitem", { name: "Q3 Launch" });
  }

  it("files an owned board into the folder you pick, then refreshes the sidebar", async () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={folders}
          placements={[]}
        />
      </TooltipProvider>,
    );

    await openMoveSubmenu("Board actions");
    fireEvent.click(screen.getByRole("menuitem", { name: "Q3 Launch" }));

    // The board the user was pointing at, into the folder they clicked — not
    // some other folder, and not `null` (which would silently UNFILE it).
    await waitFor(() =>
      expect(moveBoardToFolder).toHaveBeenCalledWith({
        boardId: "b1",
        folderId: "f2",
      }),
    );
    // Placement is server data, so the sidebar must be re-read — without this
    // the move persists but the nav shows the stale position until a reload.
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
  });

  it("files a shared board from its own row menu", async () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[]}
          sharedBoards={[sharedBoard]}
          folders={folders}
          placements={[]}
        />
      </TooltipProvider>,
    );

    await openMoveSubmenu("Board actions for Design tasks");
    fireEvent.click(screen.getByRole("menuitem", { name: "Acme Rebrand" }));

    await waitFor(() =>
      expect(moveBoardToFolder).toHaveBeenCalledWith({
        boardId: "s1",
        folderId: "f1",
      }),
    );
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
  });

  it("greys out the folder the board is already in, and only that one", async () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={folders}
          placements={[{ boardId: "b1", folderId: "f1", position: 0 }]}
        />
      </TooltipProvider>,
    );

    await openMoveSubmenu("Board actions");

    expect(
      screen.getByRole("menuitem", { name: "Acme Rebrand" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitem", { name: "Q3 Launch" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("unfiles a filed board via 'Remove from folder'", async () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={folders}
          placements={[{ boardId: "b1", folderId: "f1", position: 0 }]}
        />
      </TooltipProvider>,
    );

    await openMoveSubmenu("Board actions");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove from folder" }),
    );

    await waitFor(() =>
      expect(moveBoardToFolder).toHaveBeenCalledWith({
        boardId: "b1",
        folderId: null,
      }),
    );
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
  });

  it("offers no 'Remove from folder' on a board that isn't in one", async () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={folders}
          placements={[]}
        />
      </TooltipProvider>,
    );

    await openMoveSubmenu("Board actions");

    expect(
      screen.queryByRole("menuitem", { name: "Remove from folder" }),
    ).not.toBeInTheDocument();
  });

  it("toasts and does not refresh when the move fails", async () => {
    vi.mocked(moveBoardToFolder).mockResolvedValue({
      ok: false,
      error: "Nope.",
    });
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={folders}
          placements={[]}
        />
      </TooltipProvider>,
    );

    await openMoveSubmenu("Board actions");
    fireEvent.click(screen.getByRole("menuitem", { name: "Acme Rebrand" }));

    await waitFor(() =>
      expect(showMutationError).toHaveBeenCalledWith(
        "Couldn't move the board.",
        expect.objectContaining({ message: "Nope." }),
      ),
    );
    // A failed move changed nothing on the server — re-reading would just
    // repaint the same nav and hide the failure.
    expect(routerRefresh).not.toHaveBeenCalled();
  });
});

describe("BoardFolderRow as a drop target", () => {
  const folder = { id: "f1", name: "Acme Rebrand" };

  it("stays an inert row — no drop testid — when no drop ref is supplied", () => {
    render(
      <BoardFolderRow folder={folder} count={1}>
        <span>Website revamp</span>
      </BoardFolderRow>,
    );
    expect(screen.queryByTestId("folder-drop-f1")).not.toBeInTheDocument();
  });

  it("opens a collapsed folder while a board is dragged over it", () => {
    useUIStore.setState({ collapsedSections: { "folder:f1": true } });
    const noop = () => {};
    const { rerender } = render(
      <BoardFolderRow folder={folder} count={1} dropRef={noop} isOver={false}>
        <span>Website revamp</span>
      </BoardFolderRow>,
    );
    expect(
      screen.getByRole("button", { name: /Expand Acme Rebrand/i }),
    ).toBeInTheDocument();

    rerender(
      <BoardFolderRow folder={folder} count={1} dropRef={noop} isOver>
        <span>Website revamp</span>
      </BoardFolderRow>,
    );

    // Dropping into a closed folder would hide the board the user just filed,
    // so hovering opens it first.
    expect(
      screen.getByRole("button", { name: /Collapse Acme Rebrand/i }),
    ).toBeInTheDocument();
    // Opening is client state only — never a re-read of the page's queries.
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("marks the header while a board hovers over it", () => {
    const noop = () => {};
    const { rerender } = render(
      <BoardFolderRow folder={folder} count={1} dropRef={noop} isOver={false}>
        <span>Website revamp</span>
      </BoardFolderRow>,
    );
    expect(screen.getByTestId("folder-drop-f1").className).not.toContain(
      "ring-1",
    );

    rerender(
      <BoardFolderRow folder={folder} count={1} dropRef={noop} isOver>
        <span>Website revamp</span>
      </BoardFolderRow>,
    );
    expect(screen.getByTestId("folder-drop-f1").className).toContain("ring-1");
  });
});

describe("BoardsNav drag a board onto a folder", () => {
  const unfiled = {
    id: "b1",
    name: "Website revamp",
    workspace_id: "w1",
    position: 0,
    shared_out: false,
  };
  const alsoUnfiled = {
    id: "b2",
    name: "Brand kit",
    workspace_id: "w1",
    position: 1,
    shared_out: false,
  };
  const filed = {
    id: "b3",
    name: "Moodboard",
    workspace_id: "w1",
    position: 2,
    shared_out: false,
  };

  function renderNav() {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[unfiled, alsoUnfiled, filed]}
          sharedBoards={[]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[{ boardId: "b3", folderId: "f1", position: 0 }]}
        />
      </TooltipProvider>,
    );
  }

  /** Arm the lazy drag layer and wait for the folder drop target to land. */
  async function armDragLayer() {
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));
    await screen.findByTestId("folder-drop-f1");
  }

  it("makes folder rows drop targets once the drag layer mounts", async () => {
    renderNav();
    // First paint is the plain tree: the folder renders, but @dnd-kit (and so
    // the drop target) is still off the shell bundle.
    expect(screen.getByText("Acme Rebrand")).toBeInTheDocument();
    expect(screen.queryByTestId("folder-drop-f1")).not.toBeInTheDocument();

    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));

    expect(await screen.findByTestId("folder-drop-f1")).toBeInTheDocument();
    // One context spans folders AND the unfiled list, or a board could never
    // be dragged from the list onto a folder.
    expect(screen.getByTestId("boards-nav-sortable")).toContainElement(
      screen.getByTestId("folder-drop-f1"),
    );
  });

  it("files a board dropped on a folder header, then refreshes the sidebar", async () => {
    renderNav();
    await armDragLayer();

    drop("b1", "folder:f1");

    await waitFor(() =>
      expect(moveBoardToFolder).toHaveBeenCalledWith({
        boardId: "b1",
        folderId: "f1",
      }),
    );
    // Placement is server data — which subtree the row lives in changes, so
    // the nav must be re-read.
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
    expect(reorderBoard).not.toHaveBeenCalled();
  });

  it("reorders — and does NOT refresh — when the drop lands on another board (gotcha-44)", async () => {
    renderNav();
    await armDragLayer();

    drop("b2", "b1");

    await waitFor(() => expect(reorderBoard).toHaveBeenCalled());
    expect(vi.mocked(reorderBoard).mock.calls[0][0].boardId).toBe("b2");
    expect(moveBoardToFolder).not.toHaveBeenCalled();
    // Revalidating a reorder reloads the whole sidebar; the optimistic order
    // is authoritative instead.
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("toasts and does not refresh when a dropped move fails", async () => {
    vi.mocked(moveBoardToFolder).mockResolvedValue({
      ok: false,
      error: "Nope.",
    });
    renderNav();
    await armDragLayer();

    drop("b1", "folder:f1");

    await waitFor(() =>
      expect(showMutationError).toHaveBeenCalledWith(
        "Couldn't move the board.",
        expect.objectContaining({ message: "Nope." }),
      ),
    );
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("ignores a drop that lands nowhere", async () => {
    renderNav();
    await armDragLayer();

    drop("b1", null);

    expect(moveBoardToFolder).not.toHaveBeenCalled();
    expect(reorderBoard).not.toHaveBeenCalled();
  });

  it("keeps the ⋯ 'Move to folder' path working alongside drag", async () => {
    renderNav();
    await armDragLayer();

    // Drag is an enhancement; the accessible path must survive the restructure.
    // Scope to the DRAGGABLE row: every owned row shares the "Board actions"
    // label, so an index would silently land on the folder-nested row instead.
    fireEvent.click(
      within(sortableRow("b1")).getByRole("button", { name: "Board actions" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Move to folder/ }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Acme Rebrand" }),
    ).toBeInTheDocument();
  });
});

describe("BoardsNav focus handoff into the drag layer", () => {
  const owned = [
    {
      id: "b1",
      name: "Alpha",
      workspace_id: "w1",
      position: 0,
      shared_out: false,
    },
  ];

  it("hands focus back to the row's ⋯ button when the list is entered by Shift+Tab", async () => {
    render(
      <TooltipProvider>
        <BoardsNav boards={owned} sharedBoards={[]} />
      </TooltipProvider>,
    );

    // Shift+Tab enters the list from below and lands on the row's menu button,
    // not on its link.
    const menuButton = screen.getByRole("button", { name: "Board actions" });
    menuButton.focus();
    expect(document.activeElement).toBe(menuButton);

    await screen.findByTestId("boards-nav-sortable");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Board actions" }),
      ),
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("does not drag focus backwards if the user tabbed on while the chunk loaded", async () => {
    render(
      <TooltipProvider>
        <>
          <BoardsNav boards={owned} sharedBoards={[]} />
          <button type="button">Somewhere else</button>
        </>
      </TooltipProvider>,
    );

    screen.getByRole("link", { name: "Alpha" }).focus();
    // …and the user keeps tabbing before the lazy chunk resolves.
    const onward = screen.getByRole("button", { name: "Somewhere else" });
    onward.focus();

    await screen.findByTestId("boards-nav-sortable");
    // Restoring here would yank the user back to a row they already left.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(onward);
  });
});

describe("BoardsNav folder-row focus handoff", () => {
  const ownedBoard = {
    id: "b1",
    name: "Website revamp",
    workspace_id: "w1",
    position: 0,
    shared_out: false,
  };

  function renderWithFolder() {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[{ boardId: "b1", folderId: "f1", position: 0 }]}
        />
      </TooltipProvider>,
    );
  }

  it("keeps focus on the folder chevron — the section's first Tab stop", async () => {
    renderWithFolder();

    // Folder rows render FIRST, so for anyone with a folder this chevron is
    // the first focusable thing in Boards. Arming on it must not drop focus,
    // or the very first Tab into the section lands on <body>.
    screen.getByRole("button", { name: /Collapse Acme Rebrand/i }).focus();

    await screen.findByTestId("boards-nav-sortable");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /Collapse Acme Rebrand/i }),
      ),
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("keeps focus on the folder's ⋯ button when entered by Shift+Tab", async () => {
    renderWithFolder();

    screen
      .getByRole("button", { name: "Folder actions for Acme Rebrand" })
      .focus();

    await screen.findByTestId("boards-nav-sortable");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Folder actions for Acme Rebrand" }),
      ),
    );
  });
});

describe("BoardsNav dragging a shared board", () => {
  const ownedBoard = {
    id: "b1",
    name: "Website revamp",
    workspace_id: "w1",
    position: 0,
    shared_out: false,
  };
  const sharedBoard = {
    id: "s1",
    name: "Design tasks",
    position: 0,
    owner_name: "Ada",
    access_level: "editor" as const,
  };
  const folders = [{ id: "f1", name: "Acme Rebrand", position: 0 }];
  const handleName = "Move Design tasks into a folder";

  /** Nav with one owned board filed in f1 and one unfiled shared board. */
  function renderNav() {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[sharedBoard]}
          folders={folders}
          placements={[{ boardId: "b1", folderId: "f1", position: 0 }]}
        />
      </TooltipProvider>,
    );
  }

  it("gives an unfiled shared board a drag handle once the drag layer mounts", async () => {
    renderNav();
    expect(screen.getByText("Shared with me")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: handleName })).toBeNull();

    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));

    // Shared boards are drag SOURCES only — the handle files them, it does not
    // reorder them, and its label says so.
    const handle = await screen.findByRole("button", { name: handleName });
    // `aria-roledescription` is applied by useDraggable's own attributes, so
    // this fails if the row merely LOOKS draggable without being registered.
    expect(handle).toHaveAttribute("aria-roledescription", "draggable");
    expect(
      screen.queryByRole("button", { name: /^Reorder Design tasks/ }),
    ).toBeNull();
  });

  it("files a shared board dropped on a folder header", async () => {
    renderNav();
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));
    await screen.findByTestId("folder-drop-f1");

    drop("s1", "folder:f1");

    await waitFor(() =>
      expect(moveBoardToFolder).toHaveBeenCalledWith({
        boardId: "s1",
        folderId: "f1",
      }),
    );
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled());
    expect(reorderBoard).not.toHaveBeenCalled();
  });

  it("keeps a shared board's ⋯ 'Move to folder' path once drag is armed", async () => {
    renderNav();
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));
    await screen.findByRole("button", { name: handleName });

    fireEvent.click(
      within(sortableRow("s1")).getByRole("button", {
        name: "Board actions for Design tasks",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Move to folder/ }),
    );
    // The folder list itself has to survive the restructure, not just the
    // submenu trigger.
    expect(
      await screen.findByRole("menuitem", { name: "Acme Rebrand" }),
    ).toBeInTheDocument();
  });

  it("leaves a shared board that is already filed undraggable", async () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[ownedBoard]}
          sharedBoards={[sharedBoard]}
          folders={folders}
          placements={[
            { boardId: "b1", folderId: "f1", position: 0 },
            { boardId: "s1", folderId: "f1", position: 1 },
          ]}
        />
      </TooltipProvider>,
    );
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));
    await screen.findByTestId("folder-drop-f1");

    // Rows inside a folder are not drag sources — same rule owned boards follow.
    expect(screen.queryByRole("button", { name: handleName })).toBeNull();
  });
});

describe("BoardsNav droppable measuring", () => {
  it("re-measures droppables continuously, because auto-expand resizes siblings", async () => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[
            {
              id: "b1",
              name: "Website revamp",
              workspace_id: "w1",
              position: 0,
              shared_out: false,
            },
          ]}
          sharedBoards={[]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[{ boardId: "b1", folderId: "f1", position: 0 }]}
        />
      </TooltipProvider>,
    );
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));
    await screen.findByTestId("folder-drop-f1");

    // The default (WhileDragging) caches rects at drag start and only
    // invalidates when a droppable resizes ITSELF. Expanding a folder resizes
    // its body — a sibling — so every rect below would go stale mid-drag.
    expect(dnd.props?.measuring?.droppable?.strategy).toBe(
      MeasuringStrategy.Always,
    );
  });
});

describe("BoardsNav optimistic reorder survives a client re-render", () => {
  // Reorder deliberately does NOT revalidate (gotcha-44), so the optimistic
  // client order in BoardsNavSortable IS the display. That state is re-synced
  // during render whenever the `boards` prop's IDENTITY changes — which means
  // anything that hands it a freshly-allocated array on a client-only
  // re-render silently undoes the user's drag. `groupBoardsByFolder` allocates,
  // so the fold must be memoised AND its optional-prop defaults must be
  // module-level constants (an inline `= []` re-allocates and misses the memo).
  const alpha = {
    id: "b1",
    name: "Alpha",
    workspace_id: "w1",
    position: 0,
    shared_out: false,
  };
  const beta = {
    id: "b2",
    name: "Beta",
    workspace_id: "w1",
    position: 1,
    shared_out: false,
  };
  const filedBoard = {
    id: "b3",
    name: "Moodboard",
    workspace_id: "w1",
    position: 2,
    shared_out: false,
  };
  // Hoisted, not an inline `[]`: re-rendering must hand BoardsNav the SAME
  // prop objects the server payload does, which is exactly the scenario a
  // route change produces.
  const noShared: SharedBoardEntry[] = [];

  /** Board ids in the order the mounted drag tree actually renders them. */
  function renderedRowIds(): string[] {
    return Array.from(
      screen
        .getByTestId("boards-nav-sortable")
        .querySelectorAll<HTMLElement>("[data-board-row]"),
    ).map((row) => row.dataset.boardRow ?? "");
  }

  it("keeps the dragged order when the route param changes and no folder props are passed", async () => {
    const boards = [alpha, beta];
    const { rerender } = render(
      <TooltipProvider>
        <BoardsNav boards={boards} sharedBoards={noShared} />
      </TooltipProvider>,
    );
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));
    await screen.findByTestId("boards-nav-sortable");
    expect(renderedRowIds()).toEqual(["b1", "b2"]);

    drop("b2", "b1");
    await waitFor(() => expect(reorderBoard).toHaveBeenCalled());
    expect(renderedRowIds()).toEqual(["b2", "b1"]);

    // Clicking any other board changes useParams(), re-rendering BoardsNav with
    // byte-identical server props. Nothing about the server data changed, so
    // the optimistic order must stand.
    mockUseParams.mockReturnValue({ boardId: "b1" });
    rerender(
      <TooltipProvider>
        <BoardsNav boards={boards} sharedBoards={noShared} />
      </TooltipProvider>,
    );

    expect(renderedRowIds()).toEqual(["b2", "b1"]);
    // And it was never re-persisted or revalidated behind the user's back.
    expect(reorderBoard).toHaveBeenCalledTimes(1);
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("keeps the dragged order across a re-render when a folder is present", async () => {
    // Same invariant with the folder props actually supplied: the fold still
    // has to be memoised, or `unfiledOwned` is a new array every render.
    const boards = [alpha, beta, filedBoard];
    const folders = [{ id: "f1", name: "Acme Rebrand", position: 0 }];
    const placements = [{ boardId: "b3", folderId: "f1", position: 0 }];
    const { rerender } = render(
      <TooltipProvider>
        <BoardsNav
          boards={boards}
          sharedBoards={noShared}
          folders={folders}
          placements={placements}
        />
      </TooltipProvider>,
    );
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));
    await screen.findByTestId("folder-drop-f1");
    // Folder body first (b3), then the unfiled list.
    expect(renderedRowIds()).toEqual(["b3", "b1", "b2"]);

    drop("b2", "b1");
    await waitFor(() => expect(reorderBoard).toHaveBeenCalled());
    expect(renderedRowIds()).toEqual(["b3", "b2", "b1"]);

    mockUseParams.mockReturnValue({ boardId: "b1" });
    rerender(
      <TooltipProvider>
        <BoardsNav
          boards={boards}
          sharedBoards={noShared}
          folders={folders}
          placements={placements}
        />
      </TooltipProvider>,
    );

    expect(renderedRowIds()).toEqual(["b3", "b2", "b1"]);
  });
});

describe("BoardsNav optimistic reorder survives a re-allocated prop", () => {
  // The block above proves the memo holds when the caller passes the SAME
  // arrays. This one removes that assumption: the guard must survive a caller
  // that hands down a freshly-allocated, content-identical list — which is what
  // a single `boards.filter(...)` upstream produces, and what an
  // identity-based sync silently reads as "the server sent a new list".
  const alpha = {
    id: "b1",
    name: "Alpha",
    workspace_id: "w1",
    position: 0,
    shared_out: false,
  };
  const beta = {
    id: "b2",
    name: "Beta",
    workspace_id: "w1",
    position: 1,
    shared_out: false,
  };
  const noShared: SharedBoardEntry[] = [];

  function renderedRowIds(): string[] {
    return Array.from(
      screen
        .getByTestId("boards-nav-sortable")
        .querySelectorAll<HTMLElement>("[data-board-row]"),
    ).map((row) => row.dataset.boardRow ?? "");
  }

  /** Render, arm the drag layer, and perform the b2-over-b1 drag. */
  async function renderAndDrag() {
    const boards = [alpha, beta];
    const view = render(
      <TooltipProvider>
        <BoardsNav boards={boards} sharedBoards={noShared} />
      </TooltipProvider>,
    );
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-body"));
    await screen.findByTestId("boards-nav-sortable");
    expect(renderedRowIds()).toEqual(["b1", "b2"]);

    drop("b2", "b1");
    await waitFor(() => expect(reorderBoard).toHaveBeenCalled());
    expect(renderedRowIds()).toEqual(["b2", "b1"]);
    return view;
  }

  it("keeps the dragged order when the prop is re-allocated with identical content", async () => {
    const { rerender } = await renderAndDrag();

    // A FRESHLY ALLOCATED array with byte-identical contents. Note that only
    // `boards` is re-allocated — `sharedBoards` keeps its reference, so there is
    // no ambiguity about which prop caused a resync.
    rerender(
      <TooltipProvider>
        <BoardsNav boards={[alpha, beta]} sharedBoards={noShared} />
      </TooltipProvider>,
    );

    expect(renderedRowIds()).toEqual(["b2", "b1"]);
    expect(reorderBoard).toHaveBeenCalledTimes(1);
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("still resyncs when the server list genuinely changed (a rename)", async () => {
    const { rerender } = await renderAndDrag();

    // Without this companion, `navSyncKey` could return a constant and the test
    // above would still pass — the exact shape gotcha-89 catalogues. A rename
    // also proves the key covers `name`, not just ids and positions.
    rerender(
      <TooltipProvider>
        <BoardsNav
          boards={[{ ...alpha, name: "Alpha renamed" }, beta]}
          sharedBoards={noShared}
        />
      </TooltipProvider>,
    );

    expect(renderedRowIds()).toEqual(["b1", "b2"]);
    expect(screen.getByRole("link", { name: "Alpha renamed" })).toBeVisible();
  });

  it("still resyncs when only a position changed", async () => {
    const { rerender } = await renderAndDrag();

    rerender(
      <TooltipProvider>
        <BoardsNav
          boards={[{ ...alpha, position: 7 }, beta]}
          sharedBoards={noShared}
        />
      </TooltipProvider>,
    );

    expect(renderedRowIds()).toEqual(["b1", "b2"]);
  });
});

describe("BoardsNav folder row alignment", () => {
  // jsdom has no layout, so this is class arithmetic — which is exactly where
  // the bug lived. The folder body indents with `pl-3` (12px). An owned row
  // reserves a 24px grip slot as its first child, putting its link at 36px. A
  // shared row that fell back to its own `pl-3` and skipped that slot put its
  // link at 24px — 12px out, in the one view this whole feature exists for (a
  // folder holding one of your boards and one shared with you).
  function filedRow(boardId: string): HTMLElement {
    const row = screen
      .getByTestId("boards-nav-body")
      .querySelector<HTMLElement>(`[data-board-row="${boardId}"]`);
    if (!row) throw new Error(`No filed row for ${boardId}`);
    return row;
  }

  beforeEach(() => {
    render(
      <TooltipProvider>
        <BoardsNav
          boards={[
            {
              id: "own",
              name: "My board",
              workspace_id: "w1",
              position: 0,
              shared_out: false,
            },
          ]}
          sharedBoards={[
            {
              id: "shared",
              name: "Their board",
              position: 0,
              access_level: "viewer",
              owner_name: "Dana",
            },
          ]}
          folders={[{ id: "f1", name: "Acme Rebrand", position: 0 }]}
          placements={[
            { boardId: "own", folderId: "f1", position: 0 },
            { boardId: "shared", folderId: "f1", position: 1 },
          ]}
        />
      </TooltipProvider>,
    );
  });

  it("gives a filed shared row the same 24px leading slot as a filed owned row", () => {
    for (const id of ["own", "shared"]) {
      expect(filedRow(id).firstElementChild?.className).toContain("size-6");
    }
  });

  it("never double-indents a filed row with its own padding", () => {
    // The folder body already supplies the indent; a `pl-3` on the row itself
    // is the shared row's old fallback and would stack on top of it.
    for (const id of ["own", "shared"]) {
      expect(filedRow(id).className).not.toMatch(/(^|\s)pl-\d/);
    }
  });

  it("keeps both filed rows' links on the same column (no row-level gap)", () => {
    // A row-level `gap` sits BETWEEN the 24px slot and the link, pushing the
    // link off the owned row's column by the gap width — the same
    // misalignment, just smaller.
    for (const id of ["own", "shared"]) {
      expect(filedRow(id).className).not.toMatch(/(^|\s)gap-/);
    }
  });
});
