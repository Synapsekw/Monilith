import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

const createFolder = vi.fn();
vi.mock("@/lib/boards/folders/actions", () => ({
  createFolder: (...args: unknown[]) => createFolder(...args),
}));

const showMutationSuccess = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationSuccess: (...args: unknown[]) => showMutationSuccess(...args),
  showMutationError: vi.fn(),
  showUndoToast: vi.fn(),
}));

import { NewFolderDialog } from "@/components/boards/NewFolderDialog";

beforeEach(() => {
  refresh.mockReset();
  showMutationSuccess.mockReset();
  createFolder.mockReset();
  createFolder.mockResolvedValue({ ok: true, data: { id: "f1" } });
});

/** Open the dialog and type a name — the only path a user has to a folder. */
function openAndType(value: string) {
  render(<NewFolderDialog />);
  fireEvent.click(screen.getByRole("button", { name: "New folder" }));
  fireEvent.change(screen.getByLabelText("Folder name"), {
    target: { value },
  });
}

describe("NewFolderDialog", () => {
  it("creates a folder with the trimmed name, then closes and refreshes", async () => {
    // This is the ONLY way a user can create a folder, so it is the one path
    // that must never ship broken.
    openAndType("  Acme Rebrand  ");
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));

    await waitFor(() =>
      expect(createFolder).toHaveBeenCalledWith({ name: "Acme Rebrand" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "New folder" }),
      ).not.toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("confirms the create with a toast that names the folder and says what to do next", async () => {
    // A new folder is empty, and an empty folder is not rendered in the nav —
    // so the sidebar does not change and this toast is the ONLY evidence the
    // create worked. It also carries the discovery path for the new folder.
    openAndType("Acme Rebrand");
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));

    await waitFor(() => expect(showMutationSuccess).toHaveBeenCalled());
    const [headline, description] = showMutationSuccess.mock.calls[0];
    expect(headline).toContain("Acme Rebrand");
    expect(headline).toMatch(/created/i);
    expect(description).toMatch(/⋯/);
  });

  it("shows the action's error, keeps the dialog open, and does not toast success", async () => {
    createFolder.mockResolvedValue({ ok: false, error: "Name already used." });
    openAndType("Acme Rebrand");
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Name already used.",
    );
    expect(screen.getByLabelText("Folder name")).toBeInTheDocument();
    expect(showMutationSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("submits on Enter without a mouse", async () => {
    // The dialog is the keyboard path too — the form's onSubmit, not a click
    // handler, has to be what fires the action.
    openAndType("Keyboard folder");
    fireEvent.submit(screen.getByLabelText("Folder name").closest("form")!);

    await waitFor(() =>
      expect(createFolder).toHaveBeenCalledWith({ name: "Keyboard folder" }),
    );
  });

  it("refuses to submit a whitespace-only name", () => {
    openAndType("   ");

    expect(
      screen.getByRole("button", { name: "Create folder" }),
    ).toBeDisabled();
    expect(createFolder).not.toHaveBeenCalled();
  });
});
