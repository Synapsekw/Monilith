import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardsIndexSkeleton } from "./BoardsIndexSkeleton";

describe("BoardsIndexSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<BoardsIndexSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors BoardsIndex's centered column scaffold", () => {
    render(<BoardsIndexSkeleton />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("mx-auto");
    expect(status.className).toContain("max-w-3xl");
    expect(status.className).toContain("flex-col");
  });

  it("renders a heading block, ~5 board rows, and the archived section", () => {
    render(<BoardsIndexSkeleton />);
    expect(screen.getByTestId("skeleton-header")).toBeInTheDocument();
    expect(screen.getAllByTestId("board-row-skeleton").length).toBe(5);
    expect(screen.getByTestId("archived-section-skeleton")).toBeInTheDocument();
  });
});
