import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MyWorkSkeleton } from "./MyWorkSkeleton";

describe("MyWorkSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<MyWorkSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the page's full-height column scaffold", () => {
    render(<MyWorkSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("flex");
    expect(status.className).toContain("h-full");
    expect(status.className).toContain("flex-col");
  });

  it("renders a header bar and grouped due-bucket sections with rows", () => {
    render(<MyWorkSkeleton />);
    expect(screen.getByTestId("skeleton-header")).toBeInTheDocument();
    expect(screen.getAllByTestId("bucket-section-skeleton").length).toBe(3);
    expect(screen.getAllByTestId("my-work-row-skeleton").length).toBe(9);
  });
});
