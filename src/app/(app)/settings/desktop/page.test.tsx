import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DesktopSettingsPage from "./page";
import { getDesktopRelease } from "@/lib/desktop/read-release";

describe("Desktop settings page", () => {
  it("offers a download for both macOS architectures", () => {
    render(<DesktopSettingsPage />);
    const release = getDesktopRelease();

    const arm = screen.getByRole("link", { name: /Apple Silicon/ });
    const intel = screen.getByRole("link", { name: /Intel/ });

    // Asserts against the contract rather than a copy of the URLs, so the page
    // and desktop-release.json cannot drift apart.
    expect(arm).toHaveAttribute("href", release.downloads.macArm64);
    expect(intel).toHaveAttribute("href", release.downloads.macX64);
  });

  it("never serves an installer over plain http", () => {
    render(<DesktopSettingsPage />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
    }
  });

  it("warns that the build is unsigned and shows the workaround", () => {
    // macOS reports an unsigned app as "damaged", which reads as a corrupt
    // download. If this notice ever disappears while the build is still
    // unsigned, every download turns into a support ticket.
    render(<DesktopSettingsPage />);
    expect(screen.getByText(/isn.t signed by Apple yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/xattr -dr com\.apple\.quarantine/),
    ).toBeInTheDocument();
  });

  it("tells the user to clear quarantine on the .dmg, not the installed app", () => {
    // The regression this guards is not cosmetic: the page once pointed the
    // command at /Applications/Monolith.app, which the user can never reach —
    // Gatekeeper blocks the drag out of the quarantined disk image, so the app
    // is never installed for the command to act on. Instructions that cannot
    // be followed are worse than none, because they look authoritative.
    render(<DesktopSettingsPage />);
    const command = screen.getByText(/xattr -dr com\.apple\.quarantine/);
    expect(command).toHaveTextContent(/\.dmg\s*$/);
    expect(command).not.toHaveTextContent("/Applications/");
  });

  it("puts the quarantine step before the step that mounts the .dmg", () => {
    // Ordering IS the fix. Running it after mounting is too late.
    render(<DesktopSettingsPage />);
    const steps = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    const clear = steps.findIndex((s) => s.includes("xattr -dr"));
    const open = steps.findIndex((s) => /Open the \.dmg/i.test(s));

    expect(clear).toBeGreaterThanOrEqual(0);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(clear).toBeLessThan(open);
  });

  it("shows the shipped version", () => {
    render(<DesktopSettingsPage />);
    expect(
      screen.getByText(
        new RegExp(`Version ${getDesktopRelease().latestShell}`),
      ),
    ).toBeInTheDocument();
  });
});
