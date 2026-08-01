import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingNav } from "./landing-nav";

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

vi.mock("@/lib/fonts", () => ({ nunito: { className: "font-mock" } }));

describe("LandingNav", () => {
  it("logged out: offers Sign in and Get started", () => {
    render(<LandingNav />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("signed in: collapses to a single Enter app path", () => {
    render(<LandingNav signedIn />);
    expect(screen.getByRole("link", { name: "Enter app" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.queryByRole("link", { name: "Sign in" }),
    ).not.toBeInTheDocument();
  });

  it("the brand lockup points back at the landing splash", () => {
    render(<LandingNav />);
    expect(screen.getByRole("link", { name: "MONOLITH" })).toHaveAttribute(
      "href",
      "/landing",
    );
  });
});
