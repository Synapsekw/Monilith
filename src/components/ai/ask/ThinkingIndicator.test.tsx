import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ThinkingIndicator } from "./ThinkingIndicator";

/** The dots are decorative; the label is the meaning. Both are asserted here
 *  because "visibly alive" and "announced" are the two halves of the fix. */
function dots(container: HTMLElement) {
  return [...container.querySelectorAll("[data-slot='thinking-dot']")];
}

describe("ThinkingIndicator", () => {
  it("announces a working label by default", () => {
    render(<ThinkingIndicator />);
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("Thinking…");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("prefers the server's status once one has arrived", () => {
    render(<ThinkingIndicator label="Consulting 2 boards…" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Consulting 2 boards…",
    );
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("falls back to the default when the label is null or empty", () => {
    const { rerender } = render(<ThinkingIndicator label={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    rerender(<ThinkingIndicator label="" />);
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
  });

  it("is actually animated — three staggered, running dots", () => {
    const { container } = render(<ThinkingIndicator />);
    const d = dots(container);
    expect(d).toHaveLength(3);
    for (const dot of d) {
      expect(dot.className).toContain("animate-thinking-dot");
    }
    // Staggered, or it reads as a blink rather than a wave.
    const delays = d.map(
      (dot) => /\[animation-delay:(\d+)ms\]/.exec(dot.className)?.[1],
    );
    expect(new Set(delays).size).toBe(3);
  });

  it("stands down under prefers-reduced-motion but keeps saying so", () => {
    const { container } = render(<ThinkingIndicator />);
    for (const dot of dots(container)) {
      expect(dot.className).toContain("motion-reduce:animate-none");
    }
    // The meaning never depended on the motion.
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
  });

  it("hides the dots from assistive tech so only the label is announced", () => {
    const { container } = render(<ThinkingIndicator />);
    expect(dots(container)[0].closest("[aria-hidden='true']")).not.toBeNull();
  });
});
