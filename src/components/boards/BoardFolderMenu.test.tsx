import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

const renameFolder = vi.fn();
const deleteFolder = vi.fn();
vi.mock("@/lib/boards/folders/actions", () => ({
  renameFolder: (...args: unknown[]) => renameFolder(...args),
  deleteFolder: (...args: unknown[]) => deleteFolder(...args),
}));

import { BoardFolderMenu } from "@/components/boards/BoardFolderMenu";
import { FOLDER_GONE_ERROR } from "@/lib/boards/folders/types";

const folder = { id: "f1", name: "Acme Rebrand" };

beforeEach(() => {
  refresh.mockReset();
  renameFolder.mockReset();
  renameFolder.mockResolvedValue({ ok: true, data: undefined });
  deleteFolder.mockReset();
  deleteFolder.mockResolvedValue({ ok: true, data: undefined });
});

/** Open the folder's ⋯ menu and pick one of its entries. */
function openMenuAndSelect(entry: "Rename" | "Delete") {
  render(<BoardFolderMenu folder={folder} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Folder actions for Acme Rebrand" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: entry }));
}

describe("BoardFolderMenu", () => {
  it("renames the folder with the trimmed new name, then refreshes", async () => {
    openMenuAndSelect("Rename");

    const input = await screen.findByLabelText("Folder name");
    fireEvent.change(input, { target: { value: "  Acme Rebrand 2026  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(renameFolder).toHaveBeenCalledWith({
        folderId: "f1",
        name: "Acme Rebrand 2026",
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("does not call renameFolder when the name is unchanged", async () => {
    openMenuAndSelect("Rename");

    await screen.findByLabelText("Folder name");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Rename folder" }),
      ).not.toBeInTheDocument(),
    );
    expect(renameFolder).not.toHaveBeenCalled();
  });

  it("surfaces a failed rename and keeps the dialog open", async () => {
    renameFolder.mockResolvedValue({ ok: false, error: "Name too long." });
    openMenuAndSelect("Rename");

    fireEvent.change(await screen.findByLabelText("Folder name"), {
      target: { value: "Something else" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Name too long.",
    );
    expect(screen.getByLabelText("Folder name")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("deletes the folder once the confirmation is accepted, then refreshes", async () => {
    openMenuAndSelect("Delete");

    // Confirming is a second, deliberate click — selecting Delete in the menu
    // must not have deleted anything on its own.
    await screen.findByRole("alertdialog");
    expect(deleteFolder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));

    await waitFor(() =>
      expect(deleteFolder).toHaveBeenCalledWith({ folderId: "f1" }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("does not delete when the confirmation is cancelled", async () => {
    openMenuAndSelect("Delete");

    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(deleteFolder).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces a failed delete and does not refresh", async () => {
    deleteFolder.mockResolvedValue({ ok: false, error: "Folder is gone." });
    openMenuAndSelect("Delete");

    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Folder is gone.",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("closes and refreshes when the folder was ALREADY deleted", async () => {
    // A dead end otherwise: the dialog stayed open reporting "That folder no
    // longer exists." with Cancel as the only way forward, and the sidebar kept
    // rendering the ghost folder until a full reload. But that outcome IS the
    // user's goal — the folder is gone. Close, and refresh so the stale row
    // goes with it.
    deleteFolder.mockResolvedValue({ ok: false, error: FOLDER_GONE_ERROR });
    openMenuAndSelect("Delete");

    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalled();
  });
});
