import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortfolioGridSkeleton } from "./PortfolioGridSkeleton";

describe("PortfolioGridSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<PortfolioGridSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the full-height column scaffold", () => {
    render(<PortfolioGridSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("h-full");
    expect(status.className).toContain("flex-col");
  });

  it("renders a 9-column header and ~8 rows", () => {
    render(<PortfolioGridSkeleton />);
    expect(screen.getAllByTestId("portfolio-col-skeleton").length).toBe(9);
    expect(screen.getAllByTestId("portfolio-row-skeleton").length).toBe(8);
  });
});
