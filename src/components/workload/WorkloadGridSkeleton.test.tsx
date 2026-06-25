import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkloadGridSkeleton } from "./WorkloadGridSkeleton";

describe("WorkloadGridSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<WorkloadGridSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the full-height column scaffold", () => {
    render(<WorkloadGridSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("h-full");
    expect(status.className).toContain("flex-col");
  });

  it("renders the frozen member column at the real width (w-56)", () => {
    render(<WorkloadGridSkeleton />);
    const member = screen.getByTestId("frozen-member-col");
    expect(member.className).toContain("w-56");
    expect(member.className).toContain("sticky");
  });

  it("renders a filter toolbar and week columns", () => {
    render(<WorkloadGridSkeleton />);
    expect(screen.getByTestId("skeleton-toolbar")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("week-col-skeleton").length,
    ).toBeGreaterThanOrEqual(8);
  });
});
