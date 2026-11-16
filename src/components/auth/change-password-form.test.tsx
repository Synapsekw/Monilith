import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangePasswordForm } from "./change-password-form";

describe("ChangePasswordForm", () => {
  it("defaults to the admin-forced copy", () => {
    render(<ChangePasswordForm />);

    expect(
      screen.getByText(/administrator set a temporary/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  it("shows self-serve recovery copy for the recovery variant", () => {
    render(<ChangePasswordForm variant="recovery" />);

    expect(
      screen.queryByText(/administrator set a temporary/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/enter a new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  it("reads as a first password, not a change, for an invited person", () => {
    render(<ChangePasswordForm variant="invite" />);

    expect(screen.getByText("Set your password")).toBeInTheDocument();
    expect(
      screen.getByText(/your invitation is confirmed/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/administrator set a temporary/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/resetting/i)).not.toBeInTheDocument();
    // A first password has no connected apps to cut off.
    expect(screen.queryByText(/connected apps/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set password and continue" }),
    ).toBeInTheDocument();
  });

  // Changing the password disconnects every connected app (changeOwnPassword);
  // both variants must say so before the user submits.
  it.each(["forced", "recovery"] as const)(
    "warns that connected apps will need to reconnect (%s)",
    (variant) => {
      render(<ChangePasswordForm variant={variant} />);
      expect(
        screen.getByText(/connected apps will need to reconnect/i),
      ).toBeInTheDocument();
    },
  );

  it("renders a confirm-password field", () => {
    render(<ChangePasswordForm variant="recovery" />);

    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("toggles the new-password field between hidden and visible", async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm variant="recovery" />);

    const field = screen.getByLabelText("New password");
    expect(field).toHaveAttribute("type", "password");

    await user.click(
      screen.getByRole("button", { name: /show new password/i }),
    );
    expect(field).toHaveAttribute("type", "text");

    await user.click(
      screen.getByRole("button", { name: /hide new password/i }),
    );
    expect(field).toHaveAttribute("type", "password");
  });

  it("toggles each password field independently", async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm variant="recovery" />);

    const confirm = screen.getByLabelText("Confirm new password");
    expect(confirm).toHaveAttribute("type", "password");

    await user.click(
      screen.getByRole("button", { name: /show confirm new password/i }),
    );
    // Revealing the confirm field must not reveal the new-password field.
    expect(confirm).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("New password")).toHaveAttribute(
      "type",
      "password",
    );
  });
});
