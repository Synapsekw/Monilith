import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { BoardsNav } from "./BoardsNav";
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
  showUndoToast: vi.fn(),
}));

vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(() => false),
}));

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
    fireEvent.pointerEnter(screen.getByTestId("boards-nav-owned"));

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
