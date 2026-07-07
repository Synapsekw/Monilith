import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardItemMenu } from "./BoardItemMenu";

const duplicateBoard = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: { boardId: "x" },
}));
const renameBoard = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));
const archiveBoard = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));
const restoreBoard = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));

vi.mock("@/lib/boards/actions", () => ({
  duplicateBoard: (...a: unknown[]) => duplicateBoard(...a),
  renameBoard: (...a: unknown[]) => renameBoard(...a),
  archiveBoard: (...a: unknown[]) => archiveBoard(...a),
  restoreBoard: (...a: unknown[]) => restoreBoard(...a),
}));

// Capture the Undo toast so we can assert the offered restore path without a
// real sonner surface mounted.
let undoToast: { message: string; onUndo: () => void } | null = null;
const showMutationError = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showUndoToast: (message: string, onUndo: () => void) => {
    undoToast = { message, onUndo };
  },
  showMutationError: (...a: unknown[]) => showMutationError(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  undoToast = null;
});
const open = () =>
  userEvent.click(screen.getByRole("button", { name: /board actions/i }));

describe("BoardItemMenu", () => {
  it("shows Rename, Duplicate and Delete", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Duplicate" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("calls duplicateBoard when Duplicate is chosen", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(duplicateBoard).toHaveBeenCalledWith({ boardId: "b1" });
  });

  it("renames via the dialog", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: /board name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Roadmap 2");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(renameBoard).toHaveBeenCalledWith({
      boardId: "b1",
      name: "Roadmap 2",
    });
  });

  it("archives (moves to Trash) after confirming, with reversible copy", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    // The confirm copy reads as a reversible Trash move, not a permanent destroy.
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/move .* to trash/i);
    expect(dialog).toHaveTextContent(/restore it from trash/i);
    expect(dialog).not.toHaveTextContent(/permanent/i);
    expect(dialog).not.toHaveTextContent(/can(no|')t be undone/i);

    await userEvent.click(
      screen.getByRole("button", { name: /move to trash/i }),
    );
    expect(archiveBoard).toHaveBeenCalledWith({ boardId: "b1" });
  });

  it("offers an Undo toast that restores the board", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /move to trash/i }),
    );
    // An Undo toast is offered; invoking it restores the board.
    expect(undoToast?.message).toMatch(/trash/i);
    undoToast?.onUndo();
    expect(restoreBoard).toHaveBeenCalledWith({ boardId: "b1" });
  });

  it("surfaces a failed archive inline and keeps the confirm dialog open", async () => {
    archiveBoard.mockResolvedValueOnce({
      ok: false,
      error: "Delete blocked",
    } as never);
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /move to trash/i }),
    );
    // Error is shown and the confirm button is still there.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Delete blocked",
    );
    expect(
      screen.getByRole("button", { name: /move to trash/i }),
    ).toBeInTheDocument();
  });
});
