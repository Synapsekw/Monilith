import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LandingReveal } from "./landing-reveal";

// jsdom has no IntersectionObserver — stub a no-op so mount doesn't throw.
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("LandingReveal", () => {
  it("renders its children", () => {
    render(
      <LandingReveal>
        <p>Revealed content</p>
      </LandingReveal>,
    );
    expect(screen.getByText("Revealed content")).toBeInTheDocument();
  });

  it("keeps reduced-motion users visible via the motion-reduce CSS override", () => {
    render(
      <LandingReveal>
        <span>Reduced motion child</span>
      </LandingReveal>,
    );
    const wrapper = screen.getByText("Reduced motion child").parentElement;
    // Pre-reveal the element is opacity-0, but motion-reduce forces it visible.
    expect(wrapper).toHaveClass("motion-reduce:opacity-100");
  });
});
