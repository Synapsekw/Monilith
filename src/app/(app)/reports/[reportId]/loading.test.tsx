import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportBuilderLoading from "./loading";

describe("ReportBuilderLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<ReportBuilderLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the builder's rail-plus-preview frame", () => {
    render(<ReportBuilderLoading />);
    expect(screen.getByRole("status").className).toContain(
      "grid-cols-[320px_1fr]",
    );
    expect(screen.getAllByTestId("builder-section-skeleton").length).toBe(3);
    expect(screen.getByTestId("builder-preview-skeleton")).toBeInTheDocument();
  });
});
