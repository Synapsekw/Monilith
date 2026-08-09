import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportsLoading from "./loading";

describe("ReportsLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<ReportsLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("renders the report-row and template-row placeholders", () => {
    render(<ReportsLoading />);
    expect(screen.getAllByTestId("report-row-skeleton").length).toBe(5);
    expect(screen.getAllByTestId("template-row-skeleton").length).toBe(2);
  });
});
