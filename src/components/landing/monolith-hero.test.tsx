import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonolithHero } from "./monolith-hero";

// next/link needs the app-router context in Next 16; render a plain anchor.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("MonolithHero", () => {
  it("renders the MONOLITH wordmark", () => {
    render(<MonolithHero />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
  });

  it("logged out: nav and hero link to both /login and /signup", () => {
    render(<MonolithHero />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("signed in: shows Enter app → / and no signup link", () => {
    render(<MonolithHero signedIn />);
    const enter = screen.getAllByRole("link", { name: "Enter app" });
    expect(enter.length).toBeGreaterThan(0);
    enter.forEach((link) => expect(link).toHaveAttribute("href", "/"));
    expect(
      screen.queryByRole("link", { name: "Sign up" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Get started" }),
    ).not.toBeInTheDocument();
  });
});
