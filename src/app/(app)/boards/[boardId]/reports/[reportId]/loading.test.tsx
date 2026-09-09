import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import LegacyReportBuilderLoading from "./loading";

describe("LegacyReportBuilderLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<LegacyReportBuilderLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors a header and three content blocks", () => {
    render(<LegacyReportBuilderLoading />);
    expect(screen.getByTestId("report-header-skeleton")).toBeInTheDocument();
    expect(screen.getAllByTestId("report-block-skeleton")).toHaveLength(3);
  });

  it("does not re-render a heading or nav", () => {
    render(<LegacyReportBuilderLoading />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
