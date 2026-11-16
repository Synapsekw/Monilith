import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signOutEverywhere, toastError } = vi.hoisted(() => ({
  signOutEverywhere: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/app/auth/actions", () => ({
  signOutEverywhere: () => signOutEverywhere(),
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { SignOutEverywhereButton } from "./security-actions";

beforeEach(() => vi.clearAllMocks());

describe("SignOutEverywhereButton", () => {
  // The action only ever RETURNS on failure (success redirects away). The
  // button used to discard that result, so a failure looked like nothing
  // happened at best and like success at worst.
  it("shows the action's failure instead of swallowing it", async () => {
    signOutEverywhere.mockResolvedValue({
      ok: false,
      error: "Your connected apps could not be disconnected.",
    });
    const user = userEvent.setup();
    render(<SignOutEverywhereButton />);

    await user.click(
      screen.getByRole("button", { name: /sign out everywhere/i }),
    );

    expect(signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Your connected apps could not be disconnected.",
    );
    // The button is usable again so the user can retry.
    expect(
      screen.getByRole("button", { name: /sign out everywhere/i }),
    ).toBeEnabled();
  });

  it("reports nothing when the action redirects away", async () => {
    // On success the server action redirects; the client call resolves with
    // no result.
    signOutEverywhere.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SignOutEverywhereButton />);

    await user.click(
      screen.getByRole("button", { name: /sign out everywhere/i }),
    );

    expect(toastError).not.toHaveBeenCalled();
  });
});
