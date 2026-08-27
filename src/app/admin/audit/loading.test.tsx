import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminAuditLoading from "./loading";

describe("AdminAuditLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<AdminAuditLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAttribute("aria-label", "Loading audit log");
  });

  it("renders a feed of rows and the pager", () => {
    render(<AdminAuditLoading />);
    expect(
      screen.getAllByTestId("audit-row-skeleton").length,
    ).toBeGreaterThanOrEqual(8);
    expect(screen.getByTestId("skeleton-pager")).toBeInTheDocument();
  });
});
