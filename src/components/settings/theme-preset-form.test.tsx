import { render, screen, waitFor } from "@testing-library/react";
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
    ]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "Keystone" })).toBeChecked();
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
});
