import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The shell composes async RSC data slots behind Suspense. This test is about
// what the shell MOUNTS, so the frame renders its children and every slot is
// inert.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));
vi.mock("@/components/shell/sidebar-nav-data", () => ({
  SidebarNavData: () => null,
}));
vi.mock("@/components/shell/mobile-nav-data", () => ({
  MobileNavData: () => null,
}));
vi.mock("@/components/shell/header-user-data", () => ({
  HeaderUserData: () => null,
}));
vi.mock("@/components/shell/command-palette-data", () => ({
  CommandPaletteData: () => null,
}));

// Signed-out is the honest stand-in outside a request: every per-user promise
// resolves to its default without touching the cached profile read.
vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => null),
}));
vi.mock("@/lib/profile/queries-cached", () => ({
  getUserCelebrateDoneCached: vi.fn(),
  getUserThemePresetCached: vi.fn(),
  getUserThemeReachCached: vi.fn(),
  getUserTimeZoneCached: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

// The two sync components are replaced by markers that record the props the
// shell hands them. The real ones render nothing, so there would be nothing to
// find.
const seen = vi.hoisted(() => ({
  celebrate: [] as unknown[],
  theme: [] as { preset: unknown; reach: unknown }[],
}));
vi.mock("@/components/ui/done-burst", () => ({
  CelebrateDoneSync: ({ enabled }: { enabled: unknown }) => {
    seen.celebrate.push(enabled);
    return <span data-testid="celebrate-done-sync" />;
  },
}));
vi.mock("@/components/theme-preset-sync", () => ({
  ThemePresetSync: (props: { preset: unknown; reach: unknown }) => {
    seen.theme.push(props);
    return <span data-testid="theme-preset-sync" />;
  },
}));

import { AuthenticatedShell } from "./authenticated-shell";

describe("AuthenticatedShell", () => {
  /**
   * `isCelebrationEnabled()` is false until `<html data-celebrate>` has been
   * stamped, and `CelebrateDoneSync` is the only thing that stamps it. If the
   * shell stops mounting it, the done burst silently never plays for anyone —
   * no error, no failing render.
   */
  it("mounts CelebrateDoneSync with the account's streamed preference", async () => {
    seen.celebrate.length = 0;
    render(<AuthenticatedShell>PAGE</AuthenticatedShell>);

    expect(screen.getByTestId("celebrate-done-sync")).toBeInTheDocument();
    // Handed over UNAWAITED, so nothing above the Suspense boundary suspends.
    expect(seen.celebrate[0]).toBeInstanceOf(Promise);
    // A signed-out frame resolves to off.
    await expect(seen.celebrate[0]).resolves.toBe(false);
  });

  it("mounts ThemePresetSync with the preset and reach promises", async () => {
    seen.theme.length = 0;
    render(<AuthenticatedShell>PAGE</AuthenticatedShell>);

    expect(screen.getByTestId("theme-preset-sync")).toBeInTheDocument();
    await expect(seen.theme[0]?.preset).resolves.toBe("keystone");
    await expect(seen.theme[0]?.reach).resolves.toBe("tinted");
  });

  it("renders the page inside the frame alongside both syncs", () => {
    render(<AuthenticatedShell>PAGE</AuthenticatedShell>);
    const frame = screen.getByTestId("app-shell");
    expect(frame).toHaveTextContent("PAGE");
    expect(frame).toContainElement(screen.getByTestId("celebrate-done-sync"));
    expect(frame).toContainElement(screen.getByTestId("theme-preset-sync"));
  });
});
