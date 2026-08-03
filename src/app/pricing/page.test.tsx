import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PricingPage from "./page";
import { PRICING_TIERS } from "@/lib/billing/tiers";

describe("/pricing", () => {
  it("renders every published tier by name", () => {
    render(<PricingPage />);
    for (const t of PRICING_TIERS) {
      // The name appears in the card kicker and again as a comparison column
      // header, so assert presence rather than uniqueness.
      expect(screen.getAllByText(t.name).length).toBeGreaterThan(0);
    }
  });

  it("defaults to the annual cadence", () => {
    render(<PricingPage />);
    expect(screen.getByRole("radio", { name: "Annual" })).toBeChecked();
    expect(screen.getByText("$24")).toBeInTheDocument();
  });

  it("states the no-seat-minimum promise", () => {
    render(<PricingPage />);
    expect(screen.getAllByText(/no seat minimum/i).length).toBeGreaterThan(0);
  });

  it("marks Core as not including Ask Pulse, in text as well as a glyph", () => {
    render(<PricingPage />);
    const row = screen.getByRole("row", { name: /ask pulse/i });
    // Never colour or glyph alone: the sr-only labels carry the meaning.
    expect(within(row).getByText("Not included")).toBeInTheDocument();
    expect(within(row).getAllByText("Included").length).toBe(2);
  });

  it("answers what happens when credits run out", () => {
    render(<PricingPage />);
    expect(screen.getByText(/run out of credits/i)).toBeInTheDocument();
    expect(
      screen.getByText(/never blocks someone from updating a task/i),
    ).toBeInTheDocument();
  });

  it("keeps the comparison table in its own horizontal scroll container", () => {
    // Wide content must scroll inside itself — the page body must never scroll
    // horizontally.
    const { container } = render(<PricingPage />);
    const table = container.querySelector("table");
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
  });
});
