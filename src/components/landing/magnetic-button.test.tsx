import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MagneticButton } from "./magnetic-button";

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

describe("MagneticButton", () => {
  it("renders a link to href with its label as the accessible name", () => {
    render(<MagneticButton href="/signup">Get started</MagneticButton>);
    const link = screen.getByRole("link", { name: "Get started" });
    expect(link).toHaveAttribute("href", "/signup");
  });

  it("does not crash on pointer move/leave", () => {
    render(<MagneticButton href="/login">Sign in</MagneticButton>);
    const link = screen.getByRole("link", { name: "Sign in" });
    const wrapper = link.parentElement as HTMLElement;
    fireEvent.pointerMove(wrapper, { clientX: 10, clientY: 10 });
    fireEvent.pointerLeave(wrapper);
    expect(link).toBeInTheDocument();
  });
});
