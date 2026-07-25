import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsNav } from "./settings-nav";

const mockPathname = vi.fn(() => "/settings/profile");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

const GROUPS = [
  {
    label: "Account",
    items: [
      { href: "/settings/profile", label: "Profile" },
      { href: "/settings/security", label: "Security" },
    ],
  },
  {
    label: "Integrations",
    items: [{ href: "/settings/mcp", label: "Connect via MCP" }],
  },
];

describe("SettingsNav", () => {
  it("renders every group and item", () => {
    render(<SettingsNav groups={GROUPS} />);
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Connect via MCP" }),
    ).toBeInTheDocument();
  });

  it("marks the link matching the current pathname as current", () => {
    render(<SettingsNav groups={GROUPS} />);
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Security" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("does not render an item the caller omitted (admin-gated Members)", () => {
    render(<SettingsNav groups={GROUPS} />);
    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
  });
});
