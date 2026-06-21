import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const renameWorkspace = vi.fn<
  (a: unknown) => Promise<{ ok: true; data: undefined }>
>(async () => ({ ok: true, data: undefined }));
const deleteWorkspace = vi.fn<
  (a: unknown) => Promise<{ ok: true; data: undefined }>
>(async () => ({ ok: true, data: undefined }));
vi.mock("@/lib/workspaces/actions", () => ({
  renameWorkspace: (a: unknown) => renameWorkspace(a),
  deleteWorkspace: (a: unknown) => deleteWorkspace(a),
}));

import { WorkspaceNavItem } from "@/components/workspaces/WorkspaceNavItem";

const ws = { id: "11111111-1111-1111-1111-111111111111", name: "verify WS" };

beforeEach(() => {
  // Radix needs these jsdom polyfills (also set globally in vitest.setup.ts).
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
  renameWorkspace.mockClear();
  deleteWorkspace.mockClear();
});

describe("WorkspaceNavItem", () => {
  it("renders the workspace name", () => {
    render(
      <WorkspaceNavItem workspace={ws} isOrgAdmin={false} isLast={false} />,
    );
    expect(screen.getByText("verify WS")).toBeInTheDocument();
  });

  it("hides Delete from non-admins", async () => {
    render(
      <WorkspaceNavItem workspace={ws} isOrgAdmin={false} isLast={false} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /workspace menu/i }),
    );
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("shows Delete to admins and keeps confirm disabled until the name matches", async () => {
    render(
      <WorkspaceNavItem workspace={ws} isOrgAdmin={true} isLast={false} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /workspace menu/i }),
    );
    await userEvent.click(screen.getByText("Delete"));

    const confirmBtn = screen.getByRole("button", {
      name: /delete permanently/i,
    });
    expect(confirmBtn).toBeDisabled();

    await userEvent.type(
      screen.getByLabelText(/type the workspace name/i),
      "verify WS",
    );
    expect(confirmBtn).toBeEnabled();

    await userEvent.click(confirmBtn);
    expect(deleteWorkspace).toHaveBeenCalledWith({ workspaceId: ws.id });
  });

  it("renames on Enter", async () => {
    render(
      <WorkspaceNavItem workspace={ws} isOrgAdmin={false} isLast={false} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /workspace menu/i }),
    );
    await userEvent.click(screen.getByText("Rename"));

    const input = screen.getByLabelText("Workspace name");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");
    expect(renameWorkspace).toHaveBeenCalledWith({
      workspaceId: ws.id,
      name: "Renamed",
    });
  });
});
