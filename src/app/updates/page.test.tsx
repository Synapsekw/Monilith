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
  it("renders the heading and a back-to-home link", () => {
    render(<UpdatesPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "What's new" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("renders at least one shipped item from the curated changelog", () => {
    render(<UpdatesPage />);
    expect(screen.getByText("Board automations")).toBeInTheDocument();
  });
});
