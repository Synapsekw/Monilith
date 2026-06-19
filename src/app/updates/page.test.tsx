import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/link needs app-router context in Next 16; render a plain anchor.
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

import UpdatesPage from "./page";

describe("UpdatesPage", () => {
  it("renders the heading and a back link to the public landing splash", () => {
    render(<UpdatesPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "What's new" }),
    ).toBeInTheDocument();
    // `/landing` is the always-on splash so "back" reaches the landing even
    // for a logged-in visitor (`/` would redirect them into the app).
    expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute(
      "href",
      "/landing",
    );
  });

  it("renders at least one shipped item from the curated changelog", () => {
    render(<UpdatesPage />);
    expect(screen.getByText("Board automations")).toBeInTheDocument();
  });
});
