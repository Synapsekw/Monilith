import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("renders My boards with a shared indicator and a Shared with me section", () => {
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
    expect(screen.getByText("My boards")).toBeInTheDocument();
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
