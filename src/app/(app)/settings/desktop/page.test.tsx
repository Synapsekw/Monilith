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
      screen.getAllByText(/xattr -dr com\.apple\.quarantine/).length,
    ).toBeGreaterThan(0);
  });

  it("tells the user to clear quarantine on the .dmg, not the installed app", () => {
    // The regression this guards is not cosmetic: the page once pointed the
    // command at /Applications/Monolith.app, which the user can never reach —
    // Gatekeeper blocks the drag out of the quarantined disk image, so the app
    // is never installed for the command to act on. Instructions that cannot
    // be followed are worse than none, because they look authoritative.
    //
    // Asserted over EVERY occurrence, not the first. The command now appears in
    // both Installing and Updating, and a check that only inspects one of them
    // would pass while the other told users to do the impossible thing.
    render(<DesktopSettingsPage />);
    const commands = screen.getAllByText(/xattr -dr com\.apple\.quarantine/);
    expect(commands.length).toBeGreaterThanOrEqual(2);
    for (const command of commands) {
      expect(command).toHaveTextContent(/\.dmg\s*$/);
      expect(command).not.toHaveTextContent("/Applications/");
    }
  });

  it("tells the user to quit the app before replacing it", () => {
    // macOS refuses to overwrite a running .app, so an update guide that skips
    // this sends the reader to a "the application is in use" error with no
    // explanation. It has to come before the step that replaces the app.
    render(<DesktopSettingsPage />);
    const steps = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    const quit = steps.findIndex((s) => /Quit Monolith first/i.test(s));
    const replace = steps.findIndex((s) =>
      /replacing the existing copy/i.test(s),
    );

    expect(quit).toBeGreaterThanOrEqual(0);
    expect(replace).toBeGreaterThanOrEqual(0);
    expect(quit).toBeLessThan(replace);
  });

  it("points at the in-app update check rather than only the download links", () => {
    // The shell now reads `latestShell` and offers an update itself. If this
    // page never mentions it, the only discoverable update path stays "come
    // back to Settings and re-download", which is the thing the prompt exists
    // to replace.
    render(<DesktopSettingsPage />);
    expect(screen.getByText(/Check for Updates/i)).toBeInTheDocument();
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
