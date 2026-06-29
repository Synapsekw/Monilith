import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlatformNav } from "./PlatformNav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users" }));
vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(() => false),
}));

beforeEach(() => {
  vi.mocked(useCoarsePointer).mockReturnValue(false);
});

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

  it("collapsed + coarse: shows visible captions and ≥44px targets (gotcha-47)", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(true);
    render(
      <TooltipProvider>
        <PlatformNav isPlatformAdmin collapsed />
      </TooltipProvider>,
    );
    for (const label of ["Overview", "Organizations", "Users", "Audit log"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveTextContent(label);
      expect(link).toHaveAttribute("aria-label", label);
      expect(link.className).toContain("pointer-coarse:min-h-11");
    }
    // Active route keeps aria-current under coarse rendering.
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("collapsed + fine: stays icon-only, no caption", () => {
    vi.mocked(useCoarsePointer).mockReturnValue(false);
    render(
      <TooltipProvider>
        <PlatformNav isPlatformAdmin collapsed />
      </TooltipProvider>,
    );
    expect(
      screen.queryByText("Organizations", { selector: "span" }),
    ).not.toBeInTheDocument();
  });
});
