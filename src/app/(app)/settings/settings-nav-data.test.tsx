import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { resolveActiveOrg, isOrgAdminCached, redirect } = vi.hoisted(() => ({
  resolveActiveOrg: vi.fn(),
  isOrgAdminCached: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
  usePathname: () => "/settings/profile",
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/org/guard", () => ({
  isOrgAdminCached: (userId: string, orgId: string) =>
    isOrgAdminCached(userId, orgId),
}));

import SettingsLayout from "./layout";
import { SettingsNavData } from "./settings-nav-data";
import { settingsNavGroups } from "./settings-nav-groups";

beforeEach(() => {
  vi.clearAllMocks();
  resolveActiveOrg.mockResolvedValue({ id: "o1", name: "Acme" });
  isOrgAdminCached.mockResolvedValue(false);
});

describe("settingsNavGroups", () => {
  const hrefs = (isAdmin: boolean) =>
    settingsNavGroups(isAdmin).flatMap((g) => g.items.map((i) => i.href));

  it("offers Members to an admin only", () => {
    expect(hrefs(true)).toContain("/settings/members");
    expect(hrefs(false)).not.toContain("/settings/members");
  });

  it("differs between the two roles by that one entry and nothing else", () => {
    expect(hrefs(true).filter((h) => h !== "/settings/members")).toEqual(
      hrefs(false),
    );
  });
});

describe("SettingsNavData", () => {
  it("shows the Members entry to an org admin", async () => {
    isOrgAdminCached.mockResolvedValue(true);

    render(await SettingsNavData());

    expect(isOrgAdminCached).toHaveBeenCalledWith("u1", "o1");
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/settings/members",
    );
  });

  it("hides the Members entry from a non-admin", async () => {
    render(await SettingsNavData());

    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
  });

  it("sends a user with no organization to onboarding, without a role lookup", async () => {
    resolveActiveOrg.mockResolvedValue(null);

    await expect(SettingsNavData()).rejects.toThrow("REDIRECT:/onboarding");
    expect(isOrgAdminCached).not.toHaveBeenCalled();
  });
});

describe("SettingsLayout", () => {
  it("is synchronous and reads nothing per-request itself", () => {
    const element = SettingsLayout({ children: null });

    // An async component returns a promise; a sync one returns an element.
    expect(element).not.toBeInstanceOf(Promise);
    expect(resolveActiveOrg).not.toHaveBeenCalled();
    expect(isOrgAdminCached).not.toHaveBeenCalled();
  });
});
