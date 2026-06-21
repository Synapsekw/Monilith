import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createWorkspace = vi.fn<
  (a: unknown) => Promise<{ ok: true; data: undefined }>
>(async () => ({ ok: true, data: undefined }));
vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: (a: unknown) => createWorkspace(a),
}));

import { NewWorkspaceDialog } from "@/components/workspaces/NewWorkspaceDialog";

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  createWorkspace.mockClear();
});

describe("NewWorkspaceDialog", () => {
  it("creates a workspace from the typed name", async () => {
    render(<NewWorkspaceDialog />);
    await userEvent.click(
      screen.getByRole("button", { name: /new workspace/i }),
    );

    const input = screen.getByLabelText("Workspace name");
    await userEvent.type(input, "Marketing");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(createWorkspace).toHaveBeenCalledWith({ name: "Marketing" });
  });

  it("disables Create for an empty name", async () => {
    render(<NewWorkspaceDialog />);
    await userEvent.click(
      screen.getByRole("button", { name: /new workspace/i }),
    );
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();
  });
});
