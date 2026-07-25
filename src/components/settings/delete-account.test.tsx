import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteOwnAccount } = vi.hoisted(() => ({ deleteOwnAccount: vi.fn() }));
vi.mock("@/lib/account/actions", () => ({
  deleteOwnAccount: (input: unknown) => deleteOwnAccount(input),
}));

import { DeleteAccount } from "./delete-account";

const EMAIL = "me@example.com";
const CONFIRM_LABEL = /type your email address to confirm/i;

/** Open the dialog and hand back the interaction driver. */
async function open() {
  const user = userEvent.setup();
  render(<DeleteAccount email={EMAIL} />);
  await user.click(screen.getByRole("button", { name: /^delete account$/i }));
  return user;
}

/**
 * A promise the test resolves itself. Needed because the "in flight" assertions
 * have to observe the pending state, but leaving a never-resolving promise behind
 * strands a React transition in the shared jsdom and corrupts LATER tests (this
 * suite passed file-by-file and failed as a whole before the deferreds went in).
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => vi.resetAllMocks());

describe("DeleteAccount", () => {
  it("does nothing until the dialog is opened", () => {
    render(<DeleteAccount email={EMAIL} />);
    expect(screen.queryByLabelText(CONFIRM_LABEL)).not.toBeInTheDocument();
    expect(deleteOwnAccount).not.toHaveBeenCalled();
  });

  it("says plainly what is erased and what stays", async () => {
    await open();
    // The honesty of this copy IS the UX — a user cannot consent to a transfer
    // they were not told about.
    expect(screen.getByRole("dialog")).toHaveTextContent(/permanently/i);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      /stay with your organization/i,
    );
  });

  it("keeps the confirm button disabled until the email matches", async () => {
    const user = await open();
    const confirm = screen.getByRole("button", {
      name: /delete permanently/i,
    });
    expect(confirm).toBeDisabled();

    const input = screen.getByLabelText(CONFIRM_LABEL);
    await user.type(input, "me@exampl");
    expect(confirm).toBeDisabled();
    await user.type(input, "e.com");
    expect(confirm).toBeEnabled();
  });

  it("matches case-insensitively and trims surrounding space", async () => {
    const user = await open();
    await user.type(screen.getByLabelText(CONFIRM_LABEL), "  ME@Example.com  ");
    expect(
      screen.getByRole("button", { name: /delete permanently/i }),
    ).toBeEnabled();
  });

  it("submits the trimmed confirmation to the server action", async () => {
    deleteOwnAccount.mockResolvedValue({ ok: false, error: "nope" });
    const user = await open();
    await user.type(screen.getByLabelText(CONFIRM_LABEL), `  ${EMAIL}  `);
    await user.click(
      screen.getByRole("button", { name: /delete permanently/i }),
    );
    await waitFor(() =>
      expect(deleteOwnAccount).toHaveBeenCalledWith({ confirmEmail: EMAIL }),
    );
  });

  it("shows the server's refusal in place and keeps the dialog open", async () => {
    deleteOwnAccount.mockResolvedValue({
      ok: false,
      error: "You're the only owner of Acme.",
    });
    const user = await open();
    await user.type(screen.getByLabelText(CONFIRM_LABEL), EMAIL);
    await user.click(
      screen.getByRole("button", { name: /delete permanently/i }),
    );

    // In place, not a toast: the sole-owner refusal is a paragraph the user has
    // to read and act on.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("only owner of Acme"),
    );
    expect(screen.getByLabelText(CONFIRM_LABEL)).toBeVisible();
  });

  it("clears a previous error when the user tries again", async () => {
    deleteOwnAccount.mockResolvedValueOnce({ ok: false, error: "First fail." });
    const user = await open();
    await user.type(screen.getByLabelText(CONFIRM_LABEL), EMAIL);
    const confirm = screen.getByRole("button", { name: /delete permanently/i });
    await user.click(confirm);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // Held pending, so the stale error must already be gone before it settles.
    const second = deferred<{ ok: false; error: string }>();
    deleteOwnAccount.mockReturnValue(second.promise);
    await user.click(confirm);
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    second.resolve({ ok: false, error: "Second fail." });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("disables both the input and the confirm button while in flight", async () => {
    const inFlight = deferred<{ ok: false; error: string }>();
    deleteOwnAccount.mockReturnValue(inFlight.promise);
    const user = await open();
    await user.type(screen.getByLabelText(CONFIRM_LABEL), EMAIL);
    await user.click(
      screen.getByRole("button", { name: /delete permanently/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /deleting/i })).toBeDisabled(),
    );
    expect(screen.getByLabelText(CONFIRM_LABEL)).toBeDisabled();
    inFlight.resolve({ ok: false, error: "done" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /delete permanently/i }),
      ).toBeEnabled(),
    );
  });

  it("starts from a clean slate when reopened", async () => {
    deleteOwnAccount.mockResolvedValue({ ok: false, error: "Stale error." });
    const user = await open();
    await user.type(screen.getByLabelText(CONFIRM_LABEL), EMAIL);
    await user.click(
      screen.getByRole("button", { name: /delete permanently/i }),
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    // The trigger lives outside the dialog, which Radix aria-hides while modal —
    // so it only becomes role-queryable once the close has settled.
    await user.click(
      await screen.findByRole("button", { name: /^delete account$/i }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText(CONFIRM_LABEL)).toHaveValue("");
    expect(
      screen.getByRole("button", { name: /delete permanently/i }),
    ).toBeDisabled();
  });
});
