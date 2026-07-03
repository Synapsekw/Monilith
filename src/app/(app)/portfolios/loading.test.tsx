import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PortfoliosLoading from "./loading";

describe("PortfoliosLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<PortfoliosLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("renders the 9-column sticky table placeholders", () => {
    render(<PortfoliosLoading />);
    expect(screen.getAllByTestId("portfolio-col-skeleton").length).toBe(9);
    expect(screen.getAllByTestId("portfolio-row-skeleton").length).toBe(8);
  });
});
