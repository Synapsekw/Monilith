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
const deleteBoard = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));

vi.mock("@/lib/boards/actions", () => ({
  duplicateBoard: (...a: unknown[]) => duplicateBoard(...a),
  renameBoard: (...a: unknown[]) => renameBoard(...a),
  deleteBoard: (...a: unknown[]) => deleteBoard(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());
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

  it("deletes after confirming", async () => {
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /delete board/i }),
    );
    expect(deleteBoard).toHaveBeenCalledWith({ boardId: "b1" });
  });

  it("surfaces a failed delete inline and keeps the confirm dialog open", async () => {
    deleteBoard.mockResolvedValueOnce({
      ok: false,
      error: "Delete blocked",
    } as never);
    render(
      <BoardItemMenu board={{ id: "b1", name: "Roadmap" }} isActive={false} />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /delete board/i }),
    );
    // Error is shown and the destructive confirm button is still there.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Delete blocked",
    );
    expect(
      screen.getByRole("button", { name: /delete board/i }),
    ).toBeInTheDocument();
  });
});
