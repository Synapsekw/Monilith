import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { BoardsNav } from "./BoardsNav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";

const mockUseParams = vi.fn(() => ({}) as Record<string, string>);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => mockUseParams(),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(() => false),
}));

vi.mock("@/lib/dnd/sensors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dnd/sensors")>();
  return { useTouchAwareSensors: vi.fn(actual.useTouchAwareSensors) };
});

describe("BoardsNav", () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({});
    vi.mocked(useCoarsePointer).mockReturnValue(false);
    vi.mocked(useTouchAwareSensors).mockClear();
  });

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

  it("renders a reorder handle for each owned board when expanded", () => {
    render(<BoardsNav boards={owned} sharedBoards={[]} />);
    expect(
      screen.getByRole("button", { name: "Reorder Alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reorder Beta" }),
    ).toBeInTheDocument();
  });

  it("wires the expanded reorder DndContext via the shared touch-aware sensors", () => {
    render(<BoardsNav boards={owned} sharedBoards={[]} />);
    // The bespoke inline PointerSensor config is gone — reorder now uses the
    // shared long-press-on-touch sensors (TODO(touch-batch-2) cleared).
    expect(useTouchAwareSensors).toHaveBeenCalled();
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
