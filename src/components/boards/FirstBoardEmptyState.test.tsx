import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useUIStore } from "@/stores/ui";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const createBoardFromTemplate = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  createBoardFromTemplate: (...args: unknown[]) =>
    createBoardFromTemplate(...args),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { FirstBoardEmptyState } from "@/components/boards/FirstBoardEmptyState";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  toastError.mockReset();
  createBoardFromTemplate.mockReset();
  createBoardFromTemplate.mockResolvedValue({
    ok: true,
    data: { boardId: "b1" },
  });
  useUIStore.setState({ newBoardOpen: false });
});

describe("FirstBoardEmptyState", () => {
  it("greets the user by org name and shows a card per template", () => {
    render(<FirstBoardEmptyState orgName="Acme" workspaceId="ws1" />);

    expect(screen.getByText(/welcome to acme/i)).toBeInTheDocument();
    expect(screen.getByText("Blank board")).toBeInTheDocument();
    expect(screen.getByText("Sprint planning")).toBeInTheDocument();
    expect(screen.getByText("Content calendar")).toBeInTheDocument();
    expect(screen.getByText("Sales CRM")).toBeInTheDocument();
  });

  it("creates and opens a board when a template card is clicked", async () => {
    render(<FirstBoardEmptyState orgName="Acme" workspaceId="ws1" />);

    fireEvent.click(screen.getByRole("button", { name: /sprint planning/i }));

    await waitFor(() =>
      expect(createBoardFromTemplate).toHaveBeenCalledWith({
        workspaceId: "ws1",
        templateId: "sprints",
        name: "Sprint planning",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/boards/b1"));
  });

  it("surfaces an error via toast and does not navigate when creation fails", async () => {
    createBoardFromTemplate.mockResolvedValue({
      ok: false,
      error: "boom",
    });
    render(<FirstBoardEmptyState orgName="Acme" workspaceId="ws1" />);

    fireEvent.click(screen.getByRole("button", { name: /blank board/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("primary CTA opens the shared New board dialog via the store flag", () => {
    render(<FirstBoardEmptyState orgName="Acme" workspaceId="ws1" />);

    expect(useUIStore.getState().newBoardOpen).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: /create your first board/i }),
    );
    expect(useUIStore.getState().newBoardOpen).toBe(true);
  });

  it("disables template creation when no workspace is available", () => {
    render(<FirstBoardEmptyState orgName="Acme" />);
    expect(screen.getByRole("button", { name: /blank board/i })).toBeDisabled();
  });
});
