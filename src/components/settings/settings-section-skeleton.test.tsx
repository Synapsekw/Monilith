import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsSectionSkeleton } from "./settings-section-skeleton";

describe("SettingsSectionSkeleton", () => {
  it("exposes the busy a11y contract", () => {
    render(<SettingsSectionSkeleton />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("renders skeleton rows matching the section layout", () => {
    render(<SettingsSectionSkeleton />);
    expect(
      screen.getAllByTestId("settings-row-skeleton").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("does not re-render the shell — the layout owns the header and nav", () => {
    render(<SettingsSectionSkeleton />);
    // The fallback covers only the content column; a heading or nav here would
    // mean the nav blanks out on every section switch.
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
