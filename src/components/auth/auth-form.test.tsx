import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthForm } from "./auth-form";

describe("AuthForm", () => {
  it("renders email, password, and a submit button in login mode", () => {
    render(<AuthForm mode="login" />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/organization name/i),
    ).not.toBeInTheDocument();
  });

  it("renders an organization name field in signup mode", () => {
    render(<AuthForm mode="signup" />);

    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/full name/i)).not.toBeInTheDocument();
  });
});
