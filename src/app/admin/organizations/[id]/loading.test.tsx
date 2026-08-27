import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminOrgLoading from "./loading";

describe("AdminOrgLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<AdminOrgLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAttribute("aria-label", "Loading organization");
  });

  it("covers all three of the page's awaited regions", () => {
    // members RPC, org AI settings, and the audit feed resolve together — a
    // fallback that skipped one would pop that section in late.
    render(<AdminOrgLoading />);
    expect(screen.getByTestId("members-table-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("ai-plan-card-skeleton")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("audit-row-skeleton").length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      screen.getAllByTestId("member-row-skeleton").length,
    ).toBeGreaterThanOrEqual(5);
  });
});
