import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const createBoardFromTemplate = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  createBoardFromTemplate: (...args: unknown[]) =>
    createBoardFromTemplate(...args),
}));

import { NewBoardDialog } from "@/components/boards/NewBoardDialog";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  createBoardFromTemplate.mockReset();
  createBoardFromTemplate.mockResolvedValue({
    ok: true,
    data: { boardId: "b1" },
  });
});

describe("NewBoardDialog", () => {
  it("opens, shows a card per template, and creates from the chosen one", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);
    fireEvent.click(screen.getByRole("button", { name: /new board/i }));

    expect(screen.getByText("Blank board")).toBeInTheDocument();
    expect(screen.getByText("Sprint planning")).toBeInTheDocument();
    expect(screen.getByText("Content calendar")).toBeInTheDocument();
    expect(screen.getByText("Sales CRM")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Sprint planning"));
    fireEvent.click(screen.getByRole("button", { name: /create board/i }));

    await waitFor(() =>
      expect(createBoardFromTemplate).toHaveBeenCalledWith({
        workspaceId: "ws1",
        templateId: "sprints",
        name: "Sprint planning",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/boards/b1"));
  });

  it("defaults to the Blank template", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);
    fireEvent.click(screen.getByRole("button", { name: /new board/i }));
    fireEvent.click(screen.getByRole("button", { name: /create board/i }));
    await waitFor(() =>
      expect(createBoardFromTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: "blank" }),
      ),
    );
  });
});
