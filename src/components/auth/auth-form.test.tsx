import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Bare vi.fn() + mockResolvedValue in beforeEach — the same idiom as
// src/app/auth/actions.test.ts. The resolved value BECOMES the useActionState
// state, so it must be an object: returning undefined would make the component
// read `state.error` off undefined and crash the render.
const { signIn, signUp } = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/app/auth/actions", () => ({
  signIn: (prev: unknown, fd: FormData) => signIn(prev, fd),
  signUp: (prev: unknown, fd: FormData) => signUp(prev, fd),
}));

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

describe("AuthForm — next carrying", () => {
  beforeEach(() => {
    signIn.mockReset().mockResolvedValue({});
    signUp.mockReset().mockResolvedValue({});
  });

  async function submitLogin(props: { next?: string }) {
    render(<AuthForm mode="login" {...props} />);
    await userEvent.type(screen.getByLabelText(/email/i), "u@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenough1");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(signIn).toHaveBeenCalled());
    const fd: FormData = signIn.mock.calls[0][1];
    return fd;
  }

  it("includes next in the dispatched FormData when provided", async () => {
    const fd = await submitLogin({ next: "/boards/b1" });

    expect(fd.get("next")).toBe("/boards/b1");
    expect(fd.get("email")).toBe("u@example.com");
  });

  it("omits next entirely when not provided (not an empty string)", async () => {
    const fd = await submitLogin({});

    expect(fd.get("next")).toBeNull();
  });

  it("carries next in signup mode too", async () => {
    render(<AuthForm mode="signup" next="/boards/b1" />);
    await userEvent.type(screen.getByLabelText(/organization name/i), "Acme");
    await userEvent.type(screen.getByLabelText(/email/i), "new@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "longenough1");
    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );
    await waitFor(() => expect(signUp).toHaveBeenCalled());

    const fd: FormData = signUp.mock.calls[0][1];
    expect(fd.get("next")).toBe("/boards/b1");
  });
});

describe("AuthForm — field errors are wired to their controls", () => {
  it("makes the zod message the email input's accessible description and marks it invalid", async () => {
    render(<AuthForm mode="login" />);

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const email = screen.getByLabelText(/email/i);
    await waitFor(() =>
      expect(email).toHaveAccessibleDescription("Enter a valid email address"),
    );
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("announces the email error as a live region", async () => {
    render(<AuthForm mode="login" />);

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(
        screen.getAllByRole("alert").map((el) => el.textContent),
      ).toContain("Enter a valid email address"),
    );
  });

  it("wires the password error to the password input too", async () => {
    render(<AuthForm mode="login" />);

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const password = screen.getByLabelText(/password/i);
    await waitFor(() =>
      expect(password).toHaveAccessibleDescription("Password is required"),
    );
    expect(password).toHaveAttribute("aria-invalid", "true");
  });

  it("wires the organization-name error in signup mode", async () => {
    render(<AuthForm mode="signup" />);

    await userEvent.click(
      screen.getByRole("button", { name: /create account/i }),
    );

    const orgName = screen.getByLabelText(/organization name/i);
    await waitFor(() =>
      expect(orgName).toHaveAccessibleDescription(
        "Organization name is required",
      ),
    );
    expect(orgName).toHaveAttribute("aria-invalid", "true");
  });
});
