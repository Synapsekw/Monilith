import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardsLoading from "./loading";

describe("DashboardsLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<DashboardsLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toBe("Loading folders");
  });

  it("renders a 6-card folder grid skeleton", () => {
    const { container } = render(<DashboardsLoading />);
    expect(container.querySelectorAll(".h-32").length).toBe(6);
  });
});
