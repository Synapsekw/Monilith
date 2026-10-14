import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssemblyLanding } from "./assembly-landing";

vi.mock("./assembly-effects", () => ({ AssemblyEffects: () => null }));

describe("Assembly landing", () => {
  it("renders substantive approved content before client effects load", () => {
    const html = renderToStaticMarkup(<AssemblyLanding />);
    expect(html).toContain("Good work.");
    expect(html).toContain("Every part has a purpose");
    expect(html).toContain("500 pooled AI credits per seat");
    expect(html).toContain("/landing/assembly/board-blue.jpg");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("LOCAL DESIGN CONCEPT");
  });

  it("keeps signup and login in this deployment", () => {
    render(<AssemblyLanding />);
    for (const link of screen.getAllByRole("link", {
      name: /start your trial/i,
    })) {
      expect(link).toHaveAttribute("href", "/signup");
    }
    for (const link of screen.getAllByRole("link", { name: /log in/i })) {
      expect(link).toHaveAttribute("href", "/login");
    }
    expect(
      screen.getByRole("link", { name: /product updates/i }),
    ).toHaveAttribute("href", "/updates");
  });

  it("returns signed-in visitors to the workspace from every entry CTA", () => {
    const { container } = render(<AssemblyLanding signedIn />);
    expect(
      container.querySelectorAll('a[href="/signup"],a[href="/login"]'),
    ).toHaveLength(0);
    for (const link of screen.getAllByRole("link", { name: /enter app/i })) {
      expect(link).toHaveAttribute("href", "/");
    }
  });

  it("keeps navigation local and exposes the motion and screen controls", () => {
    const { container } = render(<AssemblyLanding />);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    for (const link of within(nav).getAllByRole("link")) {
      const href = link.getAttribute("href")!;
      expect(href).toMatch(/^#/);
      expect(container.querySelector(href)).not.toBeNull();
    }
    expect(
      screen.getByRole("button", { name: "Pause motion" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /explore the screen/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /assemble the monolith/i }),
    ).not.toBeInTheDocument();
  });
});
