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

  it("shows a forgot-password link in login mode", () => {
    render(<AuthForm mode="login" />);

    const link = screen.getByRole("link", { name: /forgot password/i });
    expect(link).toHaveAttribute("href", "/forgot-password");
  });

  it("does not show a forgot-password link in signup mode", () => {
    render(<AuthForm mode="signup" />);

    expect(
      screen.queryByRole("link", { name: /forgot password/i }),
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

  it("renders a Keystone kicker eyebrow and panel elevation on the login card", () => {
    render(<AuthForm mode="login" />);

    const kicker = screen.getByText("WELCOME");
    expect(kicker).toBeInTheDocument();
    const card = kicker.closest('[data-slot="card"]');
    expect(card).not.toBeNull();
    expect(card).toHaveClass("shadow-panel");
  });

  it("renders a different kicker eyebrow in signup mode", () => {
    render(<AuthForm mode="signup" />);

    expect(screen.getByText("GET STARTED")).toBeInTheDocument();
  });
});
