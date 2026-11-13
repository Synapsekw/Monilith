import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedBoardMenu } from "./SharedBoardMenu";

const leaveBoard = vi.fn(
  async (..._a: unknown[]): Promise<{ ok: boolean; error?: string }> => ({
    ok: true,
  }),
);
vi.mock("@/lib/boards/actions", () => ({
  leaveBoard: (...a: unknown[]) => leaveBoard(...a),
}));
// The folder submenu has its own actions and tests; stub it out here.
vi.mock("@/components/boards/MoveToFolderMenu", () => ({
  MoveToFolderMenu: () => null,
}));
const showMutationSuccess = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationSuccess: (...a: unknown[]) => showMutationSuccess(...a),
}));
const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const BOARD = { id: "b1", name: "Roadmap" };
const open = () =>
  userEvent.click(
    screen.getByRole("button", { name: /board actions for roadmap/i }),
  );
const settle = () => act(async () => {});

function mount(isActive = false) {
  render(
    <SharedBoardMenu
      board={BOARD}
      folders={[]}
      currentFolderId={null}
      isActive={isActive}
    />,
  );
}

describe("SharedBoardMenu", () => {
  it("offers Leave board, and never Delete", async () => {
    mount();
    await open();
    expect(
      screen.getByRole("menuitem", { name: "Leave board" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /delete/i }),
    ).not.toBeInTheDocument();
  });

  it("asks before leaving, and Cancel leaves nothing", async () => {
    mount();
    await open();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Leave board" }),
    );
    expect(
      screen.getByRole("alertdialog", { name: /leave “roadmap”\?/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(leaveBoard).not.toHaveBeenCalled();
  });

  it("leaves on confirm and confirms with a toast", async () => {
    mount();
    await open();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Leave board" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Leave board" }));
    await settle();
    expect(leaveBoard).toHaveBeenCalledWith({ boardId: "b1" });
    expect(showMutationSuccess).toHaveBeenCalledWith("You left “Roadmap”");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // Not on that board, so no navigation; the action's tag refresh re-renders
    // the sidebar, so the menu must not stack a router.refresh().
    expect(routerPush).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("navigates away when leaving the board that is open", async () => {
    mount(true);
    await open();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Leave board" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Leave board" }));
    await settle();
    expect(routerPush).toHaveBeenCalledWith("/boards");
  });

  it("keeps the dialog open and shows the error when leaving fails", async () => {
    leaveBoard.mockResolvedValueOnce({ ok: false, error: "Board not found." });
    mount();
    await open();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Leave board" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Leave board" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Board not found.");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
