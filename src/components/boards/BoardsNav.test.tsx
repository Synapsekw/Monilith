import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardsNav } from "./BoardsNav";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

const noWorkspaces: { id: string; name: string }[] = [];

describe("BoardsNav", () => {
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
});
