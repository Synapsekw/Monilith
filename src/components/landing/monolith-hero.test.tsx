import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonolithHero } from "./monolith-hero";

// next/font requires the Next build loader; stub it for the jsdom test env.
vi.mock("next/font/google", () => ({
  Archivo: () => ({ className: "font-archivo", variable: "", style: {} }),
}));

// next/link needs the app-router context in Next 16; render a plain anchor instead.
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

  it("links the hero to /login", () => {
    render(<MonolithHero />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/login");
  });

  it("shows the click-to-enter cue", () => {
    render(<MonolithHero />);
    expect(screen.getByText("Click to enter")).toBeInTheDocument();
  });
});
