import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CelebrateDoneForm } from "./celebrate-done-form";

const updateProfileCelebrateDone = vi.fn();
vi.mock("@/lib/profile/actions", () => ({
  updateProfileCelebrateDone: (input: { celebrateDone: boolean }) =>
    updateProfileCelebrateDone(input),
}));

const NAME = "Celebrate completed items";

beforeEach(() => {
  vi.clearAllMocks();
  updateProfileCelebrateDone.mockResolvedValue({ ok: true, data: undefined });
});

describe("CelebrateDoneForm", () => {
  it("renders a labelled switch reflecting the saved value", () => {
    const { unmount } = render(<CelebrateDoneForm initialCelebrateDone />);
    expect(screen.getByRole("switch", { name: NAME })).toBeChecked();
    unmount();

    render(<CelebrateDoneForm initialCelebrateDone={false} />);
    expect(screen.getByRole("switch", { name: NAME })).not.toBeChecked();
  });

  it("flips optimistically and persists the new value", async () => {
    let resolve: (v: { ok: true; data: undefined }) => void = () => {};
    updateProfileCelebrateDone.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    render(<CelebrateDoneForm initialCelebrateDone />);
    const toggle = screen.getByRole("switch", { name: NAME });

    await user.click(toggle);

    // Flipped before the action has resolved.
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAttribute("aria-busy", "true");
    expect(updateProfileCelebrateDone).toHaveBeenCalledWith({
      celebrateDone: false,
    });

    resolve({ ok: true, data: undefined });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-busy", "false"));
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("toggles from the keyboard", async () => {
    const user = userEvent.setup();
    render(<CelebrateDoneForm initialCelebrateDone={false} />);

    await user.tab();
    expect(screen.getByRole("switch", { name: NAME })).toHaveFocus();
    await user.keyboard(" ");

    expect(updateProfileCelebrateDone).toHaveBeenCalledWith({
      celebrateDone: true,
    });
  });

  it("rolls back and reports the error when the save fails", async () => {
    updateProfileCelebrateDone.mockResolvedValue({
      ok: false,
      error: "Could not update preference.",
    });
    const user = userEvent.setup();
    render(<CelebrateDoneForm initialCelebrateDone />);
    const toggle = screen.getByRole("switch", { name: NAME });

    await user.click(toggle);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not update preference.");
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute("aria-describedby", alert.id);
  });

  it("takes effect in the open tab at once, and reverts with a failed save", async () => {
    const root = document.documentElement;
    root.setAttribute("data-celebrate", "on");
    const user = userEvent.setup();
    render(<CelebrateDoneForm initialCelebrateDone />);
    const toggle = screen.getByRole("switch", { name: NAME });

    await user.click(toggle);
    expect(root.getAttribute("data-celebrate")).toBe("off");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-busy", "false"));

    updateProfileCelebrateDone.mockResolvedValue({
      ok: false,
      error: "Could not update preference.",
    });
    await user.click(toggle);
    await screen.findByRole("alert");
    expect(root.getAttribute("data-celebrate")).toBe("off");
    root.removeAttribute("data-celebrate");
  });

  it("clears the error on the next attempt", async () => {
    updateProfileCelebrateDone.mockResolvedValueOnce({
      ok: false,
      error: "Could not update preference.",
    });
    const user = userEvent.setup();
    render(<CelebrateDoneForm initialCelebrateDone />);
    const toggle = screen.getByRole("switch", { name: NAME });

    await user.click(toggle);
    await screen.findByRole("alert");

    await user.click(toggle);
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(toggle).not.toBeChecked();
  });
});
