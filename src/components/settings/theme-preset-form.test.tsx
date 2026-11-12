import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { THEME_PRESET_ATTR } from "@/lib/theme/presets";
import { ThemePresetForm } from "./theme-preset-form";

const updateProfileThemePreset = vi.fn();
vi.mock("@/lib/profile/actions", () => ({
  updateProfileThemePreset: (input: { themePreset: string }) =>
    updateProfileThemePreset(input),
}));

beforeEach(() => {
  vi.clearAllMocks();
  updateProfileThemePreset.mockResolvedValue({ ok: true, data: undefined });
  document.documentElement.removeAttribute(THEME_PRESET_ATTR);
});

describe("ThemePresetForm", () => {
  it("offers every preset as a radio and checks the current one", () => {
    render(<ThemePresetForm currentPreset="keystone" />);
    for (const label of [
      "Keystone",
      "Graphite",
      "Ocean",
      "Forest",
      "Ember",
      "Rose",
      "Aurora",
      "Sunset",
      "Nebula",
    ]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "Keystone" })).toBeChecked();
  });

  it("draws a two-stop gradient dot for a two-accent preset, in both modes", () => {
    render(<ThemePresetForm currentPreset="keystone" />);
    const tile = screen
      .getByRole("radio", { name: "Aurora" })
      .closest("label")!;
    const dot = (mode: string) =>
      tile.querySelector<HTMLElement>(`[data-swatch-accent="${mode}"]`)!;

    expect(dot("light").style.background).toBe(
      "linear-gradient(90deg, rgb(15, 125, 113), rgb(107, 89, 211))",
    );
    expect(dot("dark").style.background).toBe(
      "linear-gradient(90deg, rgb(95, 214, 196), rgb(157, 141, 247))",
    );
  });

  it("keeps a flat dot for a single-accent preset", () => {
    render(<ThemePresetForm currentPreset="keystone" />);
    const tile = screen.getByRole("radio", { name: "Ocean" }).closest("label")!;
    const dot = tile.querySelector<HTMLElement>(
      '[data-swatch-accent="light"]',
    )!;

    expect(dot.style.background).toBe("rgb(31, 122, 140)");
  });

  it("selects a two-accent preset like any other", async () => {
    const user = userEvent.setup();
    render(<ThemePresetForm currentPreset="keystone" />);

    await user.click(screen.getByRole("radio", { name: "Nebula" }));

    expect(document.documentElement.getAttribute(THEME_PRESET_ATTR)).toBe(
      "nebula",
    );
    expect(updateProfileThemePreset).toHaveBeenCalledWith({
      themePreset: "nebula",
    });
  });

  it("stamps the attribute synchronously on selection and persists it", async () => {
    const user = userEvent.setup();
    render(<ThemePresetForm currentPreset="keystone" />);

    await user.click(screen.getByRole("radio", { name: "Ocean" }));

    expect(document.documentElement.getAttribute(THEME_PRESET_ATTR)).toBe(
      "ocean",
    );
    expect(updateProfileThemePreset).toHaveBeenCalledWith({
      themePreset: "ocean",
    });
    expect(screen.getByRole("radio", { name: "Ocean" })).toBeChecked();
  });

  it("removes the attribute when the default preset is chosen", async () => {
    const user = userEvent.setup();
    render(<ThemePresetForm currentPreset="ocean" />);

    await user.click(screen.getByRole("radio", { name: "Keystone" }));

    expect(document.documentElement.hasAttribute(THEME_PRESET_ATTR)).toBe(
      false,
    );
    expect(updateProfileThemePreset).toHaveBeenCalledWith({
      themePreset: "keystone",
    });
  });

  it("reverts the attribute and reports the error when the save fails", async () => {
    updateProfileThemePreset.mockResolvedValue({
      ok: false,
      error: "Could not update theme.",
    });
    const user = userEvent.setup();
    render(<ThemePresetForm currentPreset="keystone" />);

    await user.click(screen.getByRole("radio", { name: "Rose" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not update theme.",
      );
    });
    expect(document.documentElement.hasAttribute(THEME_PRESET_ATTR)).toBe(
      false,
    );
    expect(screen.getByRole("radio", { name: "Keystone" })).toBeChecked();
  });

  it("follows a preset change made elsewhere (e.g. the header toggle)", async () => {
    render(<ThemePresetForm currentPreset="keystone" />);

    act(() => {
      document.documentElement.setAttribute(THEME_PRESET_ATTR, "ocean");
    });

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Ocean" })).toBeChecked();
    });
  });
});
