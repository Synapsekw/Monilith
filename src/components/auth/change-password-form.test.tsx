import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChangePasswordForm } from "./change-password-form";

describe("ChangePasswordForm", () => {
  it("defaults to the admin-forced copy", () => {
    render(<ChangePasswordForm />);

    expect(
      screen.getByText(/administrator set a temporary/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
  });

  it("shows self-serve recovery copy for the recovery variant", () => {
    render(<ChangePasswordForm variant="recovery" />);

    expect(
      screen.queryByText(/administrator set a temporary/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/enter a new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
  });
});
