import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InstalledVersion } from "./installed-version";

type BridgeWindow = typeof window & { monolith?: { version?: string } };

function withShellVersion(version: string | undefined) {
  (window as BridgeWindow).monolith =
    version === undefined ? undefined : { version };
}

afterEach(() => {
  delete (window as BridgeWindow).monolith;
});

describe("InstalledVersion", () => {
  it("says nothing in a plain browser", () => {
    // No bridge at all. Silence is the requirement: this page is served to web
    // users too, and inventing a version for them would be a lie.
    render(<InstalledVersion latest="1.0.1" />);
    expect(screen.queryByText(/You’re running/)).not.toBeInTheDocument();
  });

  it("says nothing on a shell too old to report its version", () => {
    // `version` was added to the bridge after 1.0.0 shipped, and an installed
    // shell is the one client that can never be forced to upgrade. It must
    // degrade to silence, not to a crash or a wrong answer.
    withShellVersion(undefined);
    render(<InstalledVersion latest="1.0.1" />);
    expect(screen.queryByText(/You’re running/)).not.toBeInTheDocument();
  });

  it("says nothing when the preload could not determine a version", () => {
    // "unknown" is the preload's own fallback. "You're running unknown" is
    // worse than showing nothing.
    withShellVersion("unknown");
    render(<InstalledVersion latest="1.0.1" />);
    expect(screen.queryByText(/You’re running/)).not.toBeInTheDocument();
  });

  it("reports up to date when the shell matches the latest release", () => {
    withShellVersion("1.0.1");
    render(<InstalledVersion latest="1.0.1" />);
    expect(screen.getByText(/up to date/)).toBeInTheDocument();
    expect(screen.getByText("1.0.1")).toBeInTheDocument();
  });

  it("reports an update when the shell is behind", () => {
    withShellVersion("1.0.0");
    render(<InstalledVersion latest="1.0.1" />);
    expect(screen.getByText(/update available/)).toBeInTheDocument();
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
  });

  it("compares numerically, not lexically", () => {
    // "1.0.10" < "1.0.9" as strings. Getting this backwards would tell a user
    // on the newest build that they are behind, every single launch.
    withShellVersion("1.0.10");
    render(<InstalledVersion latest="1.0.9" />);
    expect(screen.getByText(/up to date/)).toBeInTheDocument();
  });

  it("never claims an update for a shell ahead of the feed", () => {
    withShellVersion("2.0.0");
    render(<InstalledVersion latest="1.0.1" />);
    expect(screen.getByText(/up to date/)).toBeInTheDocument();
  });
});
