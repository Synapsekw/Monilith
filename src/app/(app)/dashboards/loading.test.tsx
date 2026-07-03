import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardsLoading from "./loading";

describe("DashboardsLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<DashboardsLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("renders the widget grid placeholders", () => {
    render(<DashboardsLoading />);
    expect(screen.getAllByTestId("widget-skeleton").length).toBe(6);
  });
});
