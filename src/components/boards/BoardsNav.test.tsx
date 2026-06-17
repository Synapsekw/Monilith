import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardsNav } from "./BoardsNav";

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
    render(<BoardsNav boards={[]} workspaces={noWorkspaces} />);

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
          },
        ]}
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
          },
          {
            id: "board-456",
            name: "Other Board",
            workspace_id: "w1",
            position: 1,
          },
        ]}
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
});
