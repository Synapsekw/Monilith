import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareBoardDialog } from "./ShareBoardDialog";

const shareBoard = vi.fn();
const unshareBoard = vi.fn();
vi.mock("@/lib/boards/sharing-actions", () => ({
  shareBoard: (...a: unknown[]) => shareBoard(...a),
  unshareBoard: (...a: unknown[]) => unshareBoard(...a),
}));

const members = [
  { userId: "u1", fullName: "Dana Lee", email: "dana@x.com" },
  { userId: "u2", fullName: "Sam Roe", email: "sam@x.com" },
];

beforeEach(() => {
  shareBoard.mockReset();
  unshareBoard.mockReset();
});

describe("ShareBoardDialog", () => {
  it("lists org members with an access control each", () => {
    render(
      <ShareBoardDialog
        boardId="b1"
        members={members}
        grants={[]}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText("Dana Lee")).toBeInTheDocument();
    expect(screen.getByText("Sam Roe")).toBeInTheDocument();
  });

  it("calls shareBoard with the chosen access when granting", async () => {
    shareBoard.mockResolvedValue({ ok: true });
    render(
      <ShareBoardDialog
        boardId="b1"
        members={members}
        grants={[]}
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "editor" },
    });
    await waitFor(() =>
      expect(shareBoard).toHaveBeenCalledWith({
        boardId: "b1",
        userId: "u1",
        access: "editor",
      }),
    );
  });

  it("reverts the select and shows an error when the share write fails", async () => {
    shareBoard.mockResolvedValue({ ok: false, error: "Not allowed" });
    render(
      <ShareBoardDialog
        boardId="b1"
        members={members}
        grants={[]}
        open
        onOpenChange={() => {}}
      />,
    );
    const select = screen.getByLabelText(
      "Access for Dana Lee",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "editor" } });
    // The optimistic value is rolled back to the persisted "none"…
    await waitFor(() => expect(select.value).toBe("none"));
    // …and the failure is surfaced inline.
    expect(screen.getByRole("alert")).toHaveTextContent("Not allowed");
  });

  it("calls unshareBoard when access is set back to none", async () => {
    unshareBoard.mockResolvedValue({ ok: true });
    render(
      <ShareBoardDialog
        boardId="b1"
        members={members}
        grants={[{ userId: "u1", access: "viewer" }]}
        open
        onOpenChange={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Access for Dana Lee"), {
      target: { value: "none" },
    });
    await waitFor(() =>
      expect(unshareBoard).toHaveBeenCalledWith({
        boardId: "b1",
        userId: "u1",
      }),
    );
  });
});
