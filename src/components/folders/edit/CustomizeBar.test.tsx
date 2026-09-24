import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/folders/layout-actions", () => ({
  saveFolderLayout: vi.fn(),
}));
const toast = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationError: (...a: unknown[]) => toast(...a),
}));

import { saveFolderLayout } from "@/lib/folders/layout-actions";
import { PRESETS } from "@/lib/folders/presets";
import { CustomizeBar } from "./CustomizeBar";

function setup(overrides: Partial<Parameters<typeof CustomizeBar>[0]> = {}) {
  const onReset = vi.fn();
  const onCancel = vi.fn();
  const onSaved = vi.fn();
  render(
    <CustomizeBar
      folderId="f1"
      version={1}
      preset="project"
      config={PRESETS.project}
      dirty
      onReset={onReset}
      onCancel={onCancel}
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onReset, onCancel, onSaved };
}

describe("CustomizeBar", () => {
  beforeEach(() => {
    vi.mocked(saveFolderLayout).mockReset();
    toast.mockClear();
  });

  it("Save sends folderId/version/preset/config and calls onSaved on success", async () => {
    vi.mocked(saveFolderLayout).mockResolvedValueOnce({
      ok: true,
      data: { version: 2 },
    });
    const { onSaved } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(saveFolderLayout).toHaveBeenCalledWith({
      folderId: "f1",
      version: 1,
      preset: "project",
      config: PRESETS.project,
    });
  });

  it("a stale save toasts the error and does not call onSaved", async () => {
    vi.mocked(saveFolderLayout).mockResolvedValueOnce({
      ok: false,
      error: "This layout changed — reload the page and try again.",
    });
    const { onSaved } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveFolderLayout).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      "Couldn't save the layout",
      new Error("This layout changed — reload the page and try again."),
    );
  });

  it("Cancel calls onCancel without saving", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(saveFolderLayout).not.toHaveBeenCalled();
  });

  it("Reset to preset calls onReset with the chosen preset key", () => {
    const { onReset } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Reset to preset/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "CRM" }));
    expect(onReset).toHaveBeenCalledWith("crm");
  });

  it("shows an unsaved-changes indicator only when dirty", () => {
    setup({ dirty: false });
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
});
