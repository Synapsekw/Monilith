import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRowActions } from "./user-row-actions";

// vi.mock factories are hoisted above these declarations, so the spies have to
// come from vi.hoisted — a plain `const` is still in its TDZ when the sonner
// factory reads `toast.error` eagerly. Mirrors settings/danger-zone.test.tsx.
const {
  refresh,
  deactivateUserAction,
  reactivateUserAction,
  resetUserPasswordAction,
  setUserPasswordAction,
  deleteUserAction,
  toastError,
  toastSuccess,
} = vi.hoisted(() => ({
  refresh: vi.fn(),
  deactivateUserAction: vi.fn(),
  reactivateUserAction: vi.fn(),
  resetUserPasswordAction: vi.fn(),
  setUserPasswordAction: vi.fn(),
  deleteUserAction: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));
vi.mock("@/lib/platform/search-action", () => ({
  deactivateUserAction: (id: string) => deactivateUserAction(id),
  reactivateUserAction: (id: string) => reactivateUserAction(id),
  resetUserPasswordAction: (id: string) => resetUserPasswordAction(id),
  setUserPasswordAction: (id: string, pw: string) =>
    setUserPasswordAction(id, pw),
  deleteUserAction: (id: string) => deleteUserAction(id),
}));

const USER = "22222222-2222-4222-8222-222222222222";

function renderRow(banned = false) {
  return render(
    <UserRowActions userId={USER} email="ada@example.com" banned={banned} />,
  );
}

/** Open the row's "…" menu and pick one item by its visible label. */
async function pick(label: RegExp, banned = false) {
  const user = userEvent.setup();
  renderRow(banned);
  await user.click(screen.getByRole("button", { name: "User actions" }));
  await user.click(await screen.findByRole("menuitem", { name: label }));
}

beforeEach(() => vi.clearAllMocks());

/**
 * The defect this guards: the three menu-only actions (reset email, suspend,
 * reactivate) fire with NO dialog mounted, but their failure was written into
 * the same `error` state that only the two dialogs render. Nothing was on
 * screen to show it, so a refused action — "not a platform admin", a GoTrue
 * rejection — looked exactly like a successful one: the menu closed and the
 * row sat there unchanged. Silent failure. These are transient, row-level
 * outcomes with no field to describe, so they announce as toasts, the same way
 * settings/danger-zone.tsx surfaces a refused `ActionResult`.
 */
describe("UserRowActions menu-only failures", () => {
  it("surfaces a refused password-reset email", async () => {
    resetUserPasswordAction.mockResolvedValue({
      ok: false,
      error: "Only a platform admin can do that.",
    });

    await pick(/send password reset email/i);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Only a platform admin can do that.",
      ),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces a refused suspend", async () => {
    deactivateUserAction.mockResolvedValue({
      ok: false,
      error: "User is already suspended.",
    });

    await pick(/suspend/i);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("User is already suspended."),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("surfaces a refused reactivate", async () => {
    reactivateUserAction.mockResolvedValue({
      ok: false,
      error: "Could not reach the auth service.",
    });

    await pick(/reactivate/i, true);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Could not reach the auth service.",
      ),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the action names no reason", async () => {
    deactivateUserAction.mockResolvedValue({ ok: false });

    await pick(/suspend/i);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Something went wrong."),
    );
  });
});

describe("UserRowActions menu-only successes", () => {
  it("confirms the password-reset email, which changes nothing on screen", async () => {
    resetUserPasswordAction.mockResolvedValue({ ok: true });

    await pick(/send password reset email/i);

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Password reset email sent to ada@example.com.",
        undefined,
      ),
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("stays quiet on a successful suspend — the row's status cell is the feedback", async () => {
    deactivateUserAction.mockResolvedValue({ ok: true });

    await pick(/suspend/i);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
