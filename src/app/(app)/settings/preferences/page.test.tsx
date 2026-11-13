import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserTimeZoneCached = vi.fn();
const getUserThemePresetCached = vi.fn();
const getUserThemeReachCached = vi.fn();
const getUserCelebrateDoneCached = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/profile/queries-cached", () => ({
  getUserTimeZoneCached: (id: string) => getUserTimeZoneCached(id),
  getUserThemePresetCached: (id: string) => getUserThemePresetCached(id),
  getUserThemeReachCached: (id: string) => getUserThemeReachCached(id),
  getUserCelebrateDoneCached: (id: string) => getUserCelebrateDoneCached(id),
}));
vi.mock("@/lib/profile/actions", () => ({
  updateProfileTimezone: vi.fn(),
  updateProfileThemePreset: vi.fn(),
  updateProfileThemeReach: vi.fn(),
  updateProfileCelebrateDone: vi.fn(),
}));

import PreferencesSettingsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  getUserTimeZoneCached.mockResolvedValue("UTC");
  getUserThemePresetCached.mockResolvedValue("keystone");
  getUserThemeReachCached.mockResolvedValue("vivid");
  getUserCelebrateDoneCached.mockResolvedValue(false);
});

/** The SettingRow root for a given row label. */
function rowOf(label: string): Element | null | undefined {
  return screen.getByText(label, { selector: "p" }).parentElement
    ?.parentElement;
}

describe("PreferencesSettingsPage", () => {
  it("puts Theme reach directly under Theme, then Celebrate completed items", async () => {
    render(await PreferencesSettingsPage());

    const theme = rowOf("Theme");
    const reach = rowOf("Theme reach");
    const celebrate = rowOf("Celebrate completed items");

    expect(theme).toBeTruthy();
    expect(theme?.nextElementSibling).toBe(reach);
    expect(reach?.nextElementSibling).toBe(celebrate);

    expect(
      screen.getByText("How far your theme colour reaches into the app."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A short animation when you mark an item done."),
    ).toBeInTheDocument();
  });

  it("seeds both controls from the server-read values", async () => {
    render(await PreferencesSettingsPage());

    expect(getUserThemeReachCached).toHaveBeenCalledWith("user-1");
    expect(getUserCelebrateDoneCached).toHaveBeenCalledWith("user-1");
    expect(screen.getByRole("radio", { name: "Vivid" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Celebrate completed items" }),
    ).not.toBeChecked();
  });

  it("starts every read before any of them resolves (parallel, not sequential)", async () => {
    // A sequential `await a; await b` would never reach the later getters
    // while the first is still pending.
    getUserTimeZoneCached.mockReturnValue(new Promise(() => {}));
    void PreferencesSettingsPage();
    await vi.waitFor(() => expect(getUserTimeZoneCached).toHaveBeenCalled());

    expect(getUserThemePresetCached).toHaveBeenCalled();
    expect(getUserThemeReachCached).toHaveBeenCalled();
    expect(getUserCelebrateDoneCached).toHaveBeenCalled();
  });
});
