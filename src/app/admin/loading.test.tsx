import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminOverviewLoading from "./loading";

describe("AdminOverviewLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<AdminOverviewLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the overview's four stat cards and two panels", () => {
    render(<AdminOverviewLoading />);
    expect(screen.getAllByTestId("stat-card-skeleton")).toHaveLength(4);
    expect(screen.getAllByTestId("admin-panel-skeleton")).toHaveLength(2);
  });

  it("does not re-render the shell — the admin layout owns it", () => {
    render(<AdminOverviewLoading />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
