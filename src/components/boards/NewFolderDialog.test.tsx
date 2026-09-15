import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

const createFolder = vi.fn();
vi.mock("@/lib/folders/actions", () => ({
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
  render(<NewFolderDialog workspaceId="w1" />);
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
      expect(createFolder).toHaveBeenCalledWith({
        workspaceId: "w1",
        name: "Acme Rebrand",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "New folder" }),
      ).not.toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("confirms the create with a toast that names the folder and says what to do next", async () => {
    // The new folder DOES appear in the nav now (empty folders render), so the
    // toast's job is the next step rather than the only evidence: the folder's
    // command center is where it gets built out.
    openAndType("Acme Rebrand");
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));

    await waitFor(() => expect(showMutationSuccess).toHaveBeenCalled());
    const [headline, description] = showMutationSuccess.mock.calls[0];
    expect(headline).toContain("Acme Rebrand");
    expect(headline).toMatch(/created/i);
    expect(description).toMatch(/command center/i);
  });

  it("disables the trigger until an active workspace is known", () => {
    // A shared folder must be created IN a workspace. Without one there is
    // nothing to create it in, so the affordance is off rather than the action
    // failing after the user has typed a name.
    render(<NewFolderDialog />);
    expect(screen.getByRole("button", { name: "New folder" })).toBeDisabled();
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
      expect(createFolder).toHaveBeenCalledWith({
        workspaceId: "w1",
        name: "Keyboard folder",
      }),
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
