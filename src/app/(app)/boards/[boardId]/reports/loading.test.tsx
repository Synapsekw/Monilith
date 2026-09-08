import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportsListLoading from "./loading";

describe("ReportsListLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<ReportsListLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the header and three report row blocks", () => {
    render(<ReportsListLoading />);
    expect(screen.getByTestId("reports-header-skeleton")).toBeInTheDocument();
    expect(screen.getAllByTestId("report-block-skeleton")).toHaveLength(3);
  });

  it("does not re-render a heading or nav", () => {
    render(<ReportsListLoading />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
