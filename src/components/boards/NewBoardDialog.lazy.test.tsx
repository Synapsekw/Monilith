import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useUIStore } from "@/stores/ui";

const searchParams = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParams.value),
}));

// The dialog body (template picker + ImportWizard + AI wizard) is a
// next/dynamic chunk. Stub the module so these tests observe exactly when the
// shell mounts it, and with which props — the body's own behaviour is covered
// by NewBoardDialog.test.tsx against the real module.
vi.mock("@/components/boards/NewBoardDialogBody", () => ({
  NewBoardDialogBody: ({
    setOpen,
    initialAiOpen,
  }: {
    setOpen: (open: boolean) => void;
    initialAiOpen: boolean;
  }) => (
    <button
      type="button"
      data-testid="new-board-body"
      data-initial-ai={String(initialAiOpen)}
      onClick={() => setOpen(false)}
    />
  ),
}));

import { NewBoardDialog } from "@/components/boards/NewBoardDialog";

beforeEach(() => {
  searchParams.value = "";
  useUIStore.setState({ newBoardOpen: false });
});

describe("NewBoardDialog lazy body", () => {
  it("renders the trigger but not the dialog module until it is used", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);

    const trigger = screen.getByRole("button", { name: "New board" });
    expect(screen.queryByTestId("new-board-body")).not.toBeInTheDocument();

    // Hover/focus only warms the chunk — it must not mount anything.
    await userEvent.hover(trigger);
    expect(screen.queryByTestId("new-board-body")).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(await screen.findByTestId("new-board-body")).toHaveAttribute(
      "data-initial-ai",
      "false",
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the body mounted after the dialog closes", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);
    const trigger = screen.getByRole("button", { name: "New board" });

    await userEvent.click(trigger);
    // The stub closes the dialog on click.
    await userEvent.click(await screen.findByTestId("new-board-body"));

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Still in the tree: the exit animation and the picked template / wizard
    // state live in the body.
    expect(screen.getByTestId("new-board-body")).toBeInTheDocument();
  });

  it("collapsed: mounts the body from the store flag, and closing clears the flag", async () => {
    render(<NewBoardDialog workspaceId="ws1" collapsed />);
    expect(screen.queryByTestId("new-board-body")).not.toBeInTheDocument();

    act(() => useUIStore.setState({ newBoardOpen: true }));
    await userEvent.click(await screen.findByTestId("new-board-body"));

    expect(useUIStore.getState().newBoardOpen).toBe(false);
  });

  it("mounts the body straight away for ?ai=1, without opening the dialog", async () => {
    searchParams.value = "ai=1";
    render(<NewBoardDialog workspaceId="ws1" />);

    // The AI wizard lives in the body, so the deep link has to load it.
    expect(await screen.findByTestId("new-board-body")).toHaveAttribute(
      "data-initial-ai",
      "true",
    );
    expect(screen.getByRole("button", { name: "New board" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
