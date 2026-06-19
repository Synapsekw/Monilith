import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlatformNav } from "./PlatformNav";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users" }));

describe("PlatformNav", () => {
  it("renders nothing for non-platform users", () => {
    const { container } = render(<PlatformNav isPlatformAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the four section links for platform admins", () => {
    render(<PlatformNav isPlatformAdmin />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(
      screen.getByRole("link", { name: "Organizations" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit log" })).toBeInTheDocument();
  });

  it("marks the active route via aria-current", () => {
    render(<PlatformNav isPlatformAdmin />);
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders icon links with accessible names when collapsed", () => {
    // Collapsed mode uses Tooltip, which requires a TooltipProvider — the
    // Sidebar supplies one in the app (same pattern as DashboardsNav.test).
    render(
      <TooltipProvider>
        <PlatformNav isPlatformAdmin collapsed />
      </TooltipProvider>,
    );
    // No section header button in collapsed mode; links keep aria-labels.
    expect(
      screen.getByRole("link", { name: "Organizations" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
