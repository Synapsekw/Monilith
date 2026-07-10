import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DashboardCanvasSkeleton,
  DashboardWidgetSkeleton,
} from "./DashboardCanvasSkeleton";

describe("DashboardCanvasSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<DashboardCanvasSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the canvas layout scaffold (root wrapper + toolbar)", () => {
    render(<DashboardCanvasSkeleton />);
    const status = screen.getByRole("status");
    // Root wrapper must match DashboardCanvas: flex flex-col gap-3 p-4
    expect(status.className).toContain("flex");
    expect(status.className).toContain("flex-col");
    expect(status.className).toContain("gap-3");
    expect(status.className).toContain("p-4");
  });

  it("renders a static grid of widget-card placeholders", () => {
    render(<DashboardCanvasSkeleton />);
    expect(
      screen.getAllByTestId("widget-skeleton").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("widget card mirrors the real card chrome (border + header divider)", () => {
    render(<DashboardWidgetSkeleton />);
    const card = screen.getByTestId("widget-skeleton");
    expect(card.className).toContain("rounded-[14px]");
    expect(card.className).toContain("border");
    expect(card.className).toContain("flex-col");
  });
});
