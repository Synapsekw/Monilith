import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { reorderPosition } from "@/lib/boards/group-reorder";
import { BoardsNav } from "./BoardsNav";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockUseParams = vi.fn(() => ({}) as Record<string, string>);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => mockUseParams(),
}));

const noWorkspaces: { id: string; name: string }[] = [];

describe("BoardsNav", () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({});
  });

  it("shows 'No boards yet' when no boards are provided", () => {
    render(
      <BoardsNav boards={[]} sharedBoards={[]} workspaces={noWorkspaces} />,
    );

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
        workspaces={noWorkspaces}
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
        workspaces={noWorkspaces}
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
          workspaces={[{ id: "w1", name: "Acme" }]}
        />
      </TooltipProvider>,
    );

    const link = screen.getByRole("link", { name: "Sprint backlog" });
    expect(link).toHaveAttribute("href", "/boards/b1");
    expect(link).toHaveTextContent("S");
    expect(screen.queryByText("Boards")).not.toBeInTheDocument();
  });

  it("renders boards with a shared indicator and a Shared with me section", () => {
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
        workspaces={[{ id: "w", name: "WS" }]}
      />,
    );
    expect(screen.getByText("Shared with me")).toBeInTheDocument();
    expect(screen.getByText("Q3 Launch")).toBeInTheDocument();
    expect(screen.getByLabelText("Shared with others")).toBeInTheDocument();
    expect(screen.getByText(/Dana/)).toBeInTheDocument();

    // Viewer-access shared boards get a subtle read-only hint; editor ones don't.
    const viewerHints = screen.getAllByLabelText("View only");
    expect(viewerHints).toHaveLength(1);
    expect(screen.getByText("Q3 Launch").parentElement).toContainElement(
      viewerHints[0],
    );
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
    render(
      <BoardsNav boards={owned} sharedBoards={[]} workspaces={noWorkspaces} />,
    );
    expect(
      screen.getByRole("button", { name: "Reorder Alpha" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reorder Beta" }),
    ).toBeInTheDocument();
  });

  it("renders no reorder handles when collapsed", () => {
    render(
      <TooltipProvider>
        <BoardsNav
          collapsed
          boards={owned}
          sharedBoards={[]}
          workspaces={[{ id: "w1", name: "Acme" }]}
        />
      </TooltipProvider>,
    );
    expect(
      screen.queryByRole("button", { name: /^Reorder / }),
    ).not.toBeInTheDocument();
  });

  it("renders no reorder handles for shared boards", () => {
    render(
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
        workspaces={noWorkspaces}
      />,
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
