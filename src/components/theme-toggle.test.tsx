import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { THEME_PRESET_ATTR, THEME_PRESETS } from "@/lib/theme/presets";
import { ThemeToggle } from "./theme-toggle";

// vi.mock factories are hoisted above these declarations, so the spies have to
// come from vi.hoisted — a plain `const` is still in its TDZ when the sonner
// factory reads `toast.error` eagerly. Mirrors admin/user-row-actions.test.tsx.
const { setTheme, updateProfileThemePreset, toastError } = vi.hoisted(() => ({
  setTheme: vi.fn(),
  updateProfileThemePreset: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme, resolvedTheme: "dark" }),
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/profile/actions", () => ({
  updateProfileThemePreset: (input: { themePreset: string }) =>
    updateProfileThemePreset(input),
}));

beforeEach(() => {
  vi.clearAllMocks();
  updateProfileThemePreset.mockResolvedValue({ ok: true, data: undefined });
  document.documentElement.removeAttribute(THEME_PRESET_ATTR);
});

async function openMenu() {
  const user = userEvent.setup();
  render(<ThemeToggle />);
  await user.click(screen.getByRole("button", { name: "Toggle theme" }));
  return user;
}

describe("ThemeToggle", () => {
  it("shows the mode items, a Theme label, and one radio per preset with the current one checked", async () => {
    await openMenu();

    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();

    const radios = screen.getAllByRole("menuitemradio");
    expect(radios).toHaveLength(THEME_PRESETS.length);
    expect(radios).toHaveLength(17);
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
      expect(
        screen.getByRole("menuitemradio", { name: label }),
      ).toBeInTheDocument();
    }

    const keystone = screen.getByRole("menuitemradio", { name: "Keystone" });
    expect(keystone).toHaveAttribute("aria-checked", "true");
  });

  it("previews a two-accent preset as a gradient pill and a single-accent one as a dot", async () => {
    await openMenu();
    const swatch = (name: string) =>
      screen
        .getByRole("menuitemradio", { name })
        .querySelector<HTMLElement>("[data-swatch-accent]")!;

    // resolvedTheme is "dark" in this suite.
    for (const [name, gradient] of [
      [
        "Aurora",
        "linear-gradient(90deg, rgb(95, 214, 196), rgb(157, 141, 247))",
      ],
      [
        "Sunset",
        "linear-gradient(90deg, rgb(247, 164, 92), rgb(238, 111, 163))",
      ],
      [
        "Nebula",
        "linear-gradient(90deg, rgb(183, 156, 247), rgb(111, 168, 238))",
      ],
    ]) {
      expect(swatch(name)).toHaveAttribute("data-swatch-shape", "pill");
      expect(swatch(name)).toHaveClass("h-3", "w-6", "rounded-full");
      expect(swatch(name).style.background).toBe(gradient);
    }
    expect(swatch("Graphite")).toHaveAttribute("data-swatch-shape", "dot");
    expect(swatch("Graphite")).toHaveClass("size-3", "rounded-full");
    expect(swatch("Graphite").style.background).toBe("rgb(201, 201, 210)");
  });

  it("selecting Graphite stamps the attribute synchronously and persists it", async () => {
    const user = await openMenu();

    await user.click(screen.getByRole("menuitemradio", { name: "Graphite" }));

    expect(document.documentElement.dataset.themePreset).toBe("graphite");
    expect(updateProfileThemePreset).toHaveBeenCalledWith({
      themePreset: "graphite",
    });
  });

  it("reverts the attribute and toasts an error when the save fails", async () => {
    updateProfileThemePreset.mockResolvedValue({
      ok: false,
      error: "Could not update theme.",
    });
    const user = await openMenu();

    await user.click(screen.getByRole("menuitemradio", { name: "Graphite" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Could not update theme.");
    });
    expect(document.documentElement.hasAttribute(THEME_PRESET_ATTR)).toBe(
      false,
    );
  });
});
