import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingPricingSection } from "./pricing-section";

describe("LandingPricingSection", () => {
  it("shows the annual headline price for each tier", () => {
    render(<LandingPricingSection />);
    expect(screen.getByText("$10")).toBeInTheDocument();
    expect(screen.getByText("$24")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("links to the full pricing page", () => {
    render(<LandingPricingSection />);
    const link = screen.getByRole("link", { name: /compare plans/i });
    expect(link).toHaveAttribute("href", "/pricing");
  });

  it("has an anchor target so the nav link can reach it", () => {
    const { container } = render(<LandingPricingSection />);
    expect(container.querySelector("#pricing")).not.toBeNull();
  });

  it("ships no cadence toggle — the teaser must not grow the landing bundle", () => {
    render(<LandingPricingSection />);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});
