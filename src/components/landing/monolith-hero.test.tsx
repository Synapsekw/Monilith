import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  it("renders the wordmark in both the nav and the hero, plus the promise", () => {
    render(<MonolithHero />);
    // Nav lockup + hero display cut.
    expect(screen.getAllByText("MONOLITH")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: /now everyone gets agents too/i }),
    ).toBeInTheDocument();
  });

  // The "In active development" pill was a beta signal on a page that is meant
  // to read as a shipped product. It must not come back.
  it("does not render an in-development badge", () => {
    render(<MonolithHero />);
    expect(screen.queryByText("In active development")).not.toBeInTheDocument();
  });

  it("renders the named-agent roster", () => {
    render(<MonolithHero />);
    expect(screen.getByText("Morning Brief")).toBeInTheDocument();
    expect(screen.getByText("Triage")).toBeInTheDocument();
    expect(screen.getAllByText("AGENT")).toHaveLength(4);
  });

  it("links to the public /updates page from the footer", () => {
    render(<MonolithHero />);
    expect(screen.getByText("Invitation only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /updates →/i })).toHaveAttribute(
      "href",
      "/updates",
    );
  });

  it("logged out: hero CTAs link to both /signup and /login", () => {
    render(<MonolithHero />);
    const ctas = screen.getAllByRole("link", { name: "Get started" });
    // One in the nav, one in the hero — both to /signup.
    expect(ctas).toHaveLength(2);
    for (const cta of ctas) expect(cta).toHaveAttribute("href", "/signup");

    const signIns = screen.getAllByRole("link", { name: "Sign in" });
    expect(signIns).toHaveLength(2);
    for (const link of signIns) expect(link).toHaveAttribute("href", "/login");
  });

  it("signed in: nav and hero both offer a single Enter app path", () => {
    render(<MonolithHero signedIn />);
    const enter = screen.getAllByRole("link", { name: "Enter app" });
    expect(enter).toHaveLength(2);
    for (const link of enter) expect(link).toHaveAttribute("href", "/");
    expect(
      screen.queryByRole("link", { name: "Get started" }),
    ).not.toBeInTheDocument();
  });

  it("section nav uses in-page anchors, never router navigations", () => {
    render(<MonolithHero />);
    const nav = screen.getByRole("navigation", { name: /landing sections/i });
    // A <Link>/router nav here would re-run every query in the page
    // (working agreement #5, gotcha-09). Anchors keep it to 0 round-trips.
    const anchors = {
      Agents: "#agents",
      Product: "#features",
      Views: "#views",
    };
    for (const [label, href] of Object.entries(anchors)) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
  });
});
