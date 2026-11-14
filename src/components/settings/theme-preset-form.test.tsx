import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { THEME_PRESET_ATTR, THEME_PRESETS } from "@/lib/theme/presets";
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
      "Aurora",
      "Sunset",
      "Nebula",
      "Lagoon",
      "Tropic",
      "Orchid",
      "Peach",
      "Glacier",
      "Dusk",
      "Berry",
      "Candy",
      "Citrus",
      "Prism",
      "Mocha",
      "Neon",
    ]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "Keystone" })).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(17);
    expect(screen.getAllByRole("radio")).toHaveLength(THEME_PRESETS.length);
    // One group, announced as such.
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
  });

  it("paints each half with that mode's wash, first stop to last", () => {
    render(<ThemePresetForm currentPreset="keystone" />);
    const ground = (name: string, mode: string) =>
      screen
        .getByRole("radio", { name })
        .closest("label")!
        .querySelector<HTMLElement>(`[data-swatch-chrome="${mode}"]`)!;

    // Keystone has no preset block: its washes are `:root` / `.dark`.
    expect(ground("Keystone", "light").style.background).toBe(
      "linear-gradient(135deg, rgb(54, 67, 167), rgb(34, 44, 114))",
    );
    expect(ground("Keystone", "dark").style.background).toBe(
      "linear-gradient(135deg, rgb(33, 37, 64), rgb(8, 9, 13))",
    );
    expect(ground("Aurora", "light").style.background).toBe(
      "linear-gradient(135deg, rgb(1, 90, 79), rgb(54, 35, 108))",
    );
    expect(ground("Neon", "dark").style.background).toBe(
      "linear-gradient(135deg, rgb(2, 48, 20), rgb(7, 5, 9))",
    );
    expect(document.querySelectorAll("[data-swatch-chrome]")).toHaveLength(34);
  });

  it("rings the accent with a white hairline on the light wash, where it would sink, and not on the dark", () => {
    render(<ThemePresetForm currentPreset="keystone" />);
    for (const p of THEME_PRESETS) {
      const tile = screen
        .getByRole("radio", { name: p.label })
        .closest("label")!;
      const dot = (mode: string) =>
        tile.querySelector<HTMLElement>(`[data-swatch-accent="${mode}"]`)!;
      expect(dot("light").style.boxShadow, p.id).toBe(
        "0 0 0 1px rgba(255, 255, 255, 0.9)",
      );
      expect(dot("dark").style.boxShadow, p.id).toBe("");
    }
  });

  it("lays the tiles out in a grid that fits as many 84px tiles as its column holds", () => {
    render(<ThemePresetForm currentPreset="keystone" />);
    const grid = screen
      .getByRole("radio", { name: "Keystone" })
      .closest("label")!.parentElement!;
    expect(grid.querySelectorAll("label")).toHaveLength(17);
    expect(grid).toHaveClass(
      "grid",
      "gap-2",
      "grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))]",
    );
    // Touch target and focus ring are untouched by the new layout.
    for (const tile of grid.querySelectorAll("label")) {
      expect(tile).toHaveClass(
        "pointer-coarse:min-h-11",
        "has-[:focus-visible]:ring-2",
        "has-[:focus-visible]:ring-ring/50",
      );
    }
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

  it.each([
    "Aurora",
    "Sunset",
    "Nebula",
    "Lagoon",
    "Tropic",
    "Orchid",
    "Peach",
    "Glacier",
    "Dusk",
    "Berry",
    "Candy",
    "Citrus",
    "Prism",
    "Mocha",
    "Neon",
  ])("%s is a pill — every two-accent preset is", (label) => {
    render(<ThemePresetForm currentPreset="keystone" />);
    const tile = screen.getByRole("radio", { name: label }).closest("label")!;
    expect(tile.querySelectorAll('[data-swatch-shape="pill"]')).toHaveLength(2);
  });

  it("keeps a flat round dot for a single-accent preset", () => {
    render(<ThemePresetForm currentPreset="keystone" />);
    for (const label of ["Keystone", "Graphite"]) {
      const tile = screen.getByRole("radio", { name: label }).closest("label")!;
      const dots = tile.querySelectorAll<HTMLElement>("[data-swatch-accent]");
      expect(dots).toHaveLength(2);
      for (const dot of dots) {
        expect(dot).toHaveAttribute("data-swatch-shape", "dot");
        expect(dot).toHaveClass("size-2.5", "rounded-full");
        expect(dot).not.toHaveClass("w-5");
      }
    }
    const graphite = screen
      .getByRole("radio", { name: "Graphite" })
      .closest("label")!
      .querySelector<HTMLElement>('[data-swatch-accent="light"]')!;
    expect(graphite.style.background).toBe("rgb(75, 75, 85)");
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

    await user.click(screen.getByRole("radio", { name: "Graphite" }));

    expect(document.documentElement.getAttribute(THEME_PRESET_ATTR)).toBe(
      "graphite",
    );
    expect(updateProfileThemePreset).toHaveBeenCalledWith({
      themePreset: "graphite",
    });
    expect(screen.getByRole("radio", { name: "Graphite" })).toBeChecked();
  });

  it("removes the attribute when the default preset is chosen", async () => {
    const user = userEvent.setup();
    render(<ThemePresetForm currentPreset="graphite" />);

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

    await user.click(screen.getByRole("radio", { name: "Graphite" }));

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
      document.documentElement.setAttribute(THEME_PRESET_ATTR, "graphite");
    });

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Graphite" })).toBeChecked();
    });
  });
});
