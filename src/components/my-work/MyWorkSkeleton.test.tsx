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

  it("reserves a Today block above the due buckets so the list does not jump", () => {
    render(<MyWorkSkeleton />);
    const today = screen.getByTestId("today-skeleton");
    const firstBucket = screen.getAllByTestId("bucket-section-skeleton")[0];
    expect(
      today.compareDocumentPosition(firstBucket) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Today's placeholder rows are not counted as due-bucket rows.
    expect(screen.getAllByTestId("my-work-row-skeleton").length).toBe(9);
  });
});
