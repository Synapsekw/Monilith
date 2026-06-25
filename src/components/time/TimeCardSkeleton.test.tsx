import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimeCardSkeleton } from "./TimeCardSkeleton";

describe("TimeCardSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<TimeCardSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the full-height column scaffold", () => {
    render(<TimeCardSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("h-full");
    expect(status.className).toContain("flex-col");
  });

  it("renders the frozen label column at the real width (w-64)", () => {
    render(<TimeCardSkeleton />);
    const label = screen.getByTestId("frozen-label-col");
    expect(label.className).toContain("w-64");
    expect(label.className).toContain("sticky");
  });

  it("renders 7 day columns and a toolbar", () => {
    render(<TimeCardSkeleton />);
    expect(screen.getByTestId("skeleton-toolbar")).toBeInTheDocument();
    expect(screen.getAllByTestId("day-col-skeleton").length).toBe(7);
  });
});
