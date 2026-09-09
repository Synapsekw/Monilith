import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { THEME_PRESET_ATTR } from "@/lib/theme/presets";
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
  it("shows the mode items, a Theme label, and six preset radios with the current one checked", async () => {
    await openMenu();

    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();

    const radios = screen.getAllByRole("menuitemradio");
    expect(radios).toHaveLength(6);

    const keystone = screen.getByRole("menuitemradio", { name: "Keystone" });
    expect(keystone).toHaveAttribute("aria-checked", "true");
  });

  it("selecting Ocean stamps the attribute synchronously and persists it", async () => {
    const user = await openMenu();

    await user.click(screen.getByRole("menuitemradio", { name: "Ocean" }));

    expect(document.documentElement.dataset.themePreset).toBe("ocean");
    expect(updateProfileThemePreset).toHaveBeenCalledWith({
      themePreset: "ocean",
    });
  });

  it("reverts the attribute and toasts an error when the save fails", async () => {
    updateProfileThemePreset.mockResolvedValue({
      ok: false,
      error: "Could not update theme.",
    });
    const user = await openMenu();

    await user.click(screen.getByRole("menuitemradio", { name: "Rose" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Could not update theme.");
    });
    expect(document.documentElement.hasAttribute(THEME_PRESET_ATTR)).toBe(
      false,
    );
  });
});
