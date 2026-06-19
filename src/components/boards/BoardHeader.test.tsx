import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardHeader } from "./BoardHeader";

const renameBoard = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({ renameBoard }),
}));

vi.mock("./ViewSwitcher", () => ({
  ViewSwitcher: () => <div data-testid="view-switcher" />,
}));

// The Automations dialog pulls in Server Actions (and TanStack Query) that are
// out of scope for the header rename test; stub it to its trigger only.
vi.mock("@/components/boards/automations/AutomationsDialog", () => ({
  AutomationsDialog: () => <div data-testid="automations-dialog" />,
}));

const views = [
  { id: "v1", board_id: "b1", kind: "table", name: "Main Table" } as never,
];

beforeEach(() => {
  renameBoard.mockReset();
  refresh.mockReset();
});

describe("BoardHeader", () => {
  it("renames the board when the title is edited", async () => {
    render(
      <BoardHeader
        boardId="b1"
        boardName="Sprint backlog"
        views={views}
        selectedViewId="v1"
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Sprint backlog" }),
    );
    const input = screen.getByRole("textbox", { name: /board name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Q2 roadmap");
    await userEvent.keyboard("{Enter}");

    expect(renameBoard).toHaveBeenCalledWith("Q2 roadmap", {
      onSuccess: expect.any(Function),
    });
  });
});
