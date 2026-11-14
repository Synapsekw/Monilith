import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const moveBoardToFolder = vi.fn();
vi.mock("@/lib/folders/actions", () => ({
  moveBoardToFolder: (...a: unknown[]) => moveBoardToFolder(...a),
}));
const showMutationError = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationError: (...a: unknown[]) => showMutationError(...a),
}));

import { MoveBoardToFolderHost, useMoveBoardToFolder } from "./move-to-folder";

const onMoved = vi.fn();

function Probe() {
  const move = useMoveBoardToFolder();
  return (
    <button
      type="button"
      onClick={() =>
        move({ boardId: "b1", folderId: "f1", folderName: "DAAS", onMoved })
      }
    >
      go
    </button>
  );
}

beforeEach(() => {
  moveBoardToFolder.mockReset();
  showMutationError.mockReset();
  onMoved.mockReset();
});

describe("MoveBoardToFolderHost", () => {
  it("moves straight away when the folder is not shared", async () => {
    moveBoardToFolder.mockResolvedValue({ ok: true, data: undefined });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveBoardToFolder).toHaveBeenCalledWith({
      boardId: "b1",
      folderId: "f1",
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks before moving into a shared folder, and moves on confirm", async () => {
    moveBoardToFolder
      .mockResolvedValueOnce({
        ok: true,
        data: { needsConfirm: 2, truncated: false },
      })
      .mockResolvedValueOnce({ ok: true, data: undefined });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(
      await screen.findByText(
        "2 people in DAAS will have access to this board.",
      ),
    ).toBeInTheDocument();
    expect(onMoved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move board" }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveBoardToFolder).toHaveBeenLastCalledWith({
      boardId: "b1",
      folderId: "f1",
      confirmShared: true,
    });
  });

  it("says at least N when the server's member count was capped", async () => {
    moveBoardToFolder.mockResolvedValue({
      ok: true,
      data: { needsConfirm: 500, truncated: true },
    });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(
      await screen.findByText(
        "At least 500 people in DAAS will have access to this board.",
      ),
    ).toBeInTheDocument();
  });

  it("does nothing more when the question is cancelled", async () => {
    moveBoardToFolder.mockResolvedValue({
      ok: true,
      data: { needsConfirm: 1, truncated: false },
    });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(
      await screen.findByText(
        "1 person in DAAS will have access to this board.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(moveBoardToFolder).toHaveBeenCalledTimes(1);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it("reports a failed move and does not call onMoved", async () => {
    moveBoardToFolder.mockResolvedValue({ ok: false, error: "nope" });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(showMutationError).toHaveBeenCalledTimes(1));
    expect(showMutationError.mock.calls[0][0]).toBe("Couldn't move the board.");
    expect(onMoved).not.toHaveBeenCalled();
  });

  it("never moves into a shared folder unasked when no host is mounted", async () => {
    moveBoardToFolder.mockResolvedValue({
      ok: true,
      data: { needsConfirm: 3, truncated: false },
    });
    render(<Probe />);
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(showMutationError).toHaveBeenCalledTimes(1));
    expect(moveBoardToFolder).toHaveBeenCalledTimes(1);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it("ignores a second request while a question is open and says nothing moved", async () => {
    moveBoardToFolder
      .mockResolvedValueOnce({
        ok: true,
        data: { needsConfirm: 2, truncated: false },
      })
      .mockResolvedValueOnce({ ok: true, data: undefined });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    await screen.findByText("2 people in DAAS will have access to this board.");

    fireEvent.click(screen.getByText("go"));
    expect(moveBoardToFolder).toHaveBeenCalledTimes(1);
    expect(showMutationError).toHaveBeenCalledTimes(1);
    expect(showMutationError.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        message: "Finish the move in progress first.",
      }),
    );

    // The question is still about the first board, and answering it moves that one.
    fireEvent.click(screen.getByRole("button", { name: "Move board" }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(moveBoardToFolder).toHaveBeenCalledTimes(2);
  });

  it("ignores a second request while the first attempt is still in flight", async () => {
    let finish: (v: unknown) => void = () => {};
    moveBoardToFolder.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    fireEvent.click(screen.getByText("go"));
    expect(moveBoardToFolder).toHaveBeenCalledTimes(1);
    expect(showMutationError).toHaveBeenCalledTimes(1);
    finish({ ok: true, data: undefined });
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));

    // Free again afterwards.
    moveBoardToFolder.mockResolvedValueOnce({ ok: true, data: undefined });
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(2));
  });

  it("reports a failure after the confirm and does not report the board as moved", async () => {
    moveBoardToFolder
      .mockResolvedValueOnce({
        ok: true,
        data: { needsConfirm: 2, truncated: false },
      })
      .mockResolvedValueOnce({ ok: false, error: "Not allowed." });
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    await screen.findByText("2 people in DAAS will have access to this board.");
    fireEvent.click(screen.getByRole("button", { name: "Move board" }));

    await waitFor(() => expect(showMutationError).toHaveBeenCalledTimes(1));
    expect(showMutationError.mock.calls[0][1]).toEqual(
      expect.objectContaining({ message: "Not allowed." }),
    );
    expect(onMoved).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("reports a rejected action instead of leaving the move stuck", async () => {
    moveBoardToFolder.mockRejectedValueOnce(new Error("network"));
    render(
      <MoveBoardToFolderHost>
        <Probe />
      </MoveBoardToFolderHost>,
    );
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(showMutationError).toHaveBeenCalledTimes(1));
    moveBoardToFolder.mockResolvedValueOnce({ ok: true, data: undefined });
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
  });
});
