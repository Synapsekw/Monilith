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
});
