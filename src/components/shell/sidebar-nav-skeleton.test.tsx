import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarNavSkeleton } from "./sidebar-nav-skeleton";

describe("SidebarNavSkeleton", () => {
  it("is a labelled busy region with several row placeholders", () => {
    render(<SidebarNavSkeleton />);
    const region = screen.getByRole("status", { name: /loading navigation/i });
    expect(region).toHaveAttribute("aria-busy", "true");
    // content-shaped: at least a few rows so layout is reserved (CLS guard)
    expect(
      region.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("uses the chrome fill — it paints directly on the wash", () => {
    render(<SidebarNavSkeleton />);
    const region = screen.getByRole("status", { name: /loading navigation/i });
    const bars = region.querySelectorAll(".animate-pulse");
    expect(bars.length).toBeGreaterThanOrEqual(4);
    for (const bar of bars) {
      expect(bar).toHaveClass("bg-chrome-fill");
      expect(bar.className).not.toMatch(/\bbg-muted\b/);
    }
  });
});
