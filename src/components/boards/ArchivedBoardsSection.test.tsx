import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchivedBoardsSection } from "./ArchivedBoardsSection";

const restoreBoard = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));
const purgeBoard = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));
const showMutationError = vi.fn();

vi.mock("@/lib/boards/actions", () => ({
  restoreBoard: (...a: unknown[]) => restoreBoard(...a),
  purgeBoard: (...a: unknown[]) => purgeBoard(...a),
}));
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationError: (...a: unknown[]) => showMutationError(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const boards = [
  {
    id: "b1",
    name: "Old roadmap",
    workspace_id: "w1",
    archived_at: "2026-07-06T00:00:00Z",
  },
  {
    id: "b2",
    name: "Q1 plan",
    workspace_id: "w1",
    archived_at: "2026-07-05T00:00:00Z",
  },
];

beforeEach(() => vi.clearAllMocks());

describe("ArchivedBoardsSection", () => {
  it("renders nothing when there are no archived boards", () => {
    const { container } = render(<ArchivedBoardsSection boards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("expands to list archived boards and restores one", async () => {
    render(<ArchivedBoardsSection boards={boards} />);
    // Collapsed by default — expand the section.
    await userEvent.click(
      screen.getByRole("button", { name: /archived boards/i }),
    );
    expect(screen.getByText("Old roadmap")).toBeInTheDocument();
    expect(screen.getByText("Q1 plan")).toBeInTheDocument();

    await userEvent.click(
      screen.getAllByRole("button", { name: /restore/i })[0],
    );
    expect(restoreBoard).toHaveBeenCalledWith({ boardId: "b1" });
  });

  it("permanently deletes only after confirming", async () => {
    render(<ArchivedBoardsSection boards={boards} />);
    await userEvent.click(
      screen.getByRole("button", { name: /archived boards/i }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: /delete permanently/i })[0],
    );
    // Confirm dialog appears; purge not called until confirmed.
    expect(purgeBoard).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /^delete permanently$/i }),
    );
    expect(purgeBoard).toHaveBeenCalledWith({ boardId: "b1" });
  });

  it("surfaces a failed restore via a toast", async () => {
    restoreBoard.mockResolvedValueOnce({
      ok: false,
      error: "Only the board owner can restore this board.",
    } as never);
    render(<ArchivedBoardsSection boards={boards} />);
    await userEvent.click(
      screen.getByRole("button", { name: /archived boards/i }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: /restore/i })[0],
    );
    expect(showMutationError).toHaveBeenCalled();
  });
});
