import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonolithHero } from "./monolith-hero";

// The hero composes the full marketing page; these tests cover the hero shell
// only, so stub the sections (they add their own links, tested separately).
vi.mock("./landing-sections", () => ({ LandingSections: () => null }));

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
  it("renders the MONOLITH wordmark and the dev-status pill", () => {
    render(<MonolithHero />);
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(screen.getByText("In active development")).toBeInTheDocument();
  });

  it("links to the public /updates page from the footer", () => {
    render(<MonolithHero />);
    expect(screen.getByText("Invitation only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /updates/i })).toHaveAttribute(
      "href",
      "/updates",
    );
  });

  it("logged out: hero CTAs link to both /signup and /login", () => {
    render(<MonolithHero />);
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    // 2 CTAs + the footer Updates link.
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("signed in: shows a single Enter app → / plus the Updates link", () => {
    render(<MonolithHero signedIn />);
    const enter = screen.getByRole("link", { name: "Enter app" });
    expect(enter).toHaveAttribute("href", "/");
    // Enter app + footer Updates link.
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: "Get started" }),
    ).not.toBeInTheDocument();
  });
});
