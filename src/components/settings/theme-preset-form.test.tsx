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

  it("draws a two-stop gradient PILL for a two-accent preset, in both modes", () => {
    render(<ThemePresetForm currentPreset="keystone" />);
    const tile = screen
      .getByRole("radio", { name: "Aurora" })
      .closest("label")!;
    const swatch = (mode: string) =>
      tile.querySelector<HTMLElement>(`[data-swatch-accent="${mode}"]`)!;

    expect(swatch("light").style.background).toBe(
      "linear-gradient(90deg, rgb(15, 125, 113), rgb(107, 89, 211))",
    );
    expect(swatch("dark").style.background).toBe(
      "linear-gradient(90deg, rgb(95, 214, 196), rgb(157, 141, 247))",
    );
    // A 10px dot cannot show two stops; a 20×10 pill can.
    for (const mode of ["light", "dark"]) {
      expect(swatch(mode)).toHaveAttribute("data-swatch-shape", "pill");
      expect(swatch(mode)).toHaveClass("h-2.5", "w-5", "rounded-full");
      expect(swatch(mode)).not.toHaveClass("size-2.5");
    }
  });

  it.each(["Aurora", "Sunset", "Nebula"])(
    "%s is a pill — every two-accent preset is",
    (label) => {
      render(<ThemePresetForm currentPreset="keystone" />);
      const tile = screen.getByRole("radio", { name: label }).closest("label")!;
      expect(tile.querySelectorAll('[data-swatch-shape="pill"]')).toHaveLength(
        2,
      );
    },
  );

  it("keeps a flat round dot for a single-accent preset", () => {
    render(<ThemePresetForm currentPreset="keystone" />);
    for (const label of [
      "Keystone",
      "Graphite",
      "Ocean",
      "Forest",
      "Ember",
      "Rose",
    ]) {
      const tile = screen.getByRole("radio", { name: label }).closest("label")!;
      const dots = tile.querySelectorAll<HTMLElement>("[data-swatch-accent]");
      expect(dots).toHaveLength(2);
      for (const dot of dots) {
        expect(dot).toHaveAttribute("data-swatch-shape", "dot");
        expect(dot).toHaveClass("size-2.5", "rounded-full");
        expect(dot).not.toHaveClass("w-5");
      }
    }
    const ocean = screen
      .getByRole("radio", { name: "Ocean" })
      .closest("label")!
      .querySelector<HTMLElement>('[data-swatch-accent="light"]')!;
    expect(ocean.style.background).toBe("rgb(31, 122, 140)");
  });

  it("marks the selected tile with a bright border, a brand ring and a check — and only that tile", async () => {
    const user = userEvent.setup();
    render(<ThemePresetForm currentPreset="keystone" />);
    const tile = (name: string) =>
      screen.getByRole("radio", { name }).closest("label")!;

    expect(tile("Keystone")).toHaveAttribute("data-selected", "true");
    expect(tile("Keystone")).toHaveClass(
      "border-border-bright",
      "ring-1",
      "ring-primary",
    );
    expect(tile("Keystone").querySelector("[data-selected-check]")).not.toBe(
      null,
    );

    expect(tile("Nebula")).not.toHaveAttribute("data-selected");
    expect(tile("Nebula")).not.toHaveClass("ring-1");
    expect(tile("Nebula")).not.toHaveClass("border-border-bright");
    expect(document.querySelectorAll("[data-selected-check]")).toHaveLength(1);

    await user.click(screen.getByRole("radio", { name: "Nebula" }));

    expect(tile("Nebula")).toHaveAttribute("data-selected", "true");
    expect(tile("Nebula")).toHaveClass("ring-primary");
    expect(tile("Keystone")).not.toHaveAttribute("data-selected");
    expect(document.querySelectorAll("[data-selected-check]")).toHaveLength(1);
    // The check is decoration: the radio's name is still just the label.
    expect(screen.getByRole("radio", { name: "Nebula" })).toBeChecked();
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
