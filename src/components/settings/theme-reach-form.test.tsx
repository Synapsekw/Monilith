import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_REACH_ATTR,
  THEME_REACH_IDS,
  THEME_REACH_STORAGE_KEY,
} from "@/lib/theme/presets";
import { ThemeReachForm } from "./theme-reach-form";

const updateProfileThemeReach = vi.fn();
vi.mock("@/lib/profile/actions", () => ({
  updateProfileThemeReach: (input: { themeReach: string }) =>
    updateProfileThemeReach(input),
}));

const root = document.documentElement;

beforeEach(() => {
  vi.clearAllMocks();
  updateProfileThemeReach.mockResolvedValue({ ok: true, data: undefined });
  localStorage.clear();
  root.removeAttribute(THEME_REACH_ATTR);
});

describe("ThemeReachForm", () => {
  it("offers the three reaches as described radios and checks the current one", () => {
    render(<ThemeReachForm currentReach="tinted" />);

    expect(
      screen.getByRole("group", { name: "Theme reach" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Subtle" }),
    ).toHaveAccessibleDescription(
      "Colour stays in the frame around your work.",
    );
    expect(
      screen.getByRole("radio", { name: "Tinted" }),
    ).toHaveAccessibleDescription(
      "Your theme lightly tints surfaces, hover and charts.",
    );
    expect(
      screen.getByRole("radio", { name: "Vivid" }),
    ).toHaveAccessibleDescription(
      "Stronger tint, plus a glow behind page headers.",
    );
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Tinted" })).toBeChecked();
  });

  // The options are derived from the registry, in registry order (least to
  // most colour) — never a second hand-kept list.
  it("renders exactly one radio per registry id, in registry order", () => {
    render(<ThemeReachForm currentReach="tinted" />);
    expect(
      screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value),
    ).toEqual([...THEME_REACH_IDS]);
  });

  it("stamps the attribute and storage on selection and persists it", async () => {
    const user = userEvent.setup();
    render(<ThemeReachForm currentReach="tinted" />);

    await user.click(screen.getByRole("radio", { name: "Vivid" }));

    expect(root.getAttribute(THEME_REACH_ATTR)).toBe("vivid");
    expect(localStorage.getItem(THEME_REACH_STORAGE_KEY)).toBe("vivid");
    expect(updateProfileThemeReach).toHaveBeenCalledWith({
      themeReach: "vivid",
    });
    expect(screen.getByRole("radio", { name: "Vivid" })).toBeChecked();
  });

  it("removes the attribute when the default reach is chosen", async () => {
    root.setAttribute(THEME_REACH_ATTR, "subtle");
    const user = userEvent.setup();
    render(<ThemeReachForm currentReach="subtle" />);

    await user.click(screen.getByRole("radio", { name: "Tinted" }));

    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
    expect(updateProfileThemeReach).toHaveBeenCalledWith({
      themeReach: "tinted",
    });
  });

  it("is operable from the keyboard with arrow keys", async () => {
    const user = userEvent.setup();
    render(<ThemeReachForm currentReach="tinted" />);

    await user.tab();
    expect(screen.getByRole("radio", { name: "Tinted" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Vivid" })).toBeChecked(),
    );
    expect(updateProfileThemeReach).toHaveBeenCalledWith({
      themeReach: "vivid",
    });
  });

  it("marks the group busy while the save is in flight", async () => {
    let resolve: (v: { ok: true; data: undefined }) => void = () => {};
    updateProfileThemeReach.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    render(<ThemeReachForm currentReach="tinted" />);
    const group = screen.getByRole("group", { name: "Theme reach" });
    expect(group).toHaveAttribute("aria-busy", "false");

    await user.click(screen.getByRole("radio", { name: "Subtle" }));
    expect(group).toHaveAttribute("aria-busy", "true");

    resolve({ ok: true, data: undefined });
    await waitFor(() => expect(group).toHaveAttribute("aria-busy", "false"));
  });

  it("reverts and reports the error when the save fails", async () => {
    updateProfileThemeReach.mockResolvedValue({
      ok: false,
      error: "Could not update theme.",
    });
    const user = userEvent.setup();
    render(<ThemeReachForm currentReach="tinted" />);

    await user.click(screen.getByRole("radio", { name: "Vivid" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not update theme.");
    expect(root.hasAttribute(THEME_REACH_ATTR)).toBe(false);
    expect(localStorage.getItem(THEME_REACH_STORAGE_KEY)).toBe("tinted");
    const tinted = screen.getByRole("radio", { name: "Tinted" });
    expect(tinted).toBeChecked();
    expect(tinted.getAttribute("aria-describedby")).toContain(alert.id);
  });
});
