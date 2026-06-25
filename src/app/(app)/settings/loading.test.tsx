import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsLoading from "./loading";

describe("SettingsLoading", () => {
  it("exposes the busy a11y contract", () => {
    render(<SettingsLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.getAttribute("aria-label")).toMatch(/^Loading/);
  });

  it("mirrors the centered settings column (max-w-3xl)", () => {
    render(<SettingsLoading />);
    const status = screen.getByRole("status");
    expect(status.className).toContain("max-w-3xl");
    expect(status.className).toContain("mx-auto");
  });

  it("renders three card placeholders", () => {
    render(<SettingsLoading />);
    expect(screen.getAllByTestId("settings-card-skeleton").length).toBe(3);
  });
});
