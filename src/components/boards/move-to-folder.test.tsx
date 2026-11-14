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
});
