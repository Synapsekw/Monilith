import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { countPendingAccounts } = vi.hoisted(() => ({
  countPendingAccounts: vi.fn(),
}));

vi.mock("@/lib/platform/queries", () => ({
  getPlatformStats: async () => ({
    orgs: 1,
    users: 2,
    admins: 1,
    events24h: 0,
  }),
  listAllOrgs: async () => [],
  platformAuditFeed: async () => [],
  countPendingAccounts: () => countPendingAccounts(),
}));
// The feed has its own tests; the overview test only cares about the notice.
vi.mock("@/components/settings/activity-feed", () => ({
  ActivityFeed: () => null,
}));

import AdminOverview from "./page";

beforeEach(() => countPendingAccounts.mockReset());

describe("/admin overview", () => {
  it("links to /admin/users when accounts are waiting", async () => {
    countPendingAccounts.mockResolvedValue(3);
    render(await AdminOverview());
    const link = screen.getByRole("link", {
      name: /3 accounts waiting for approval/i,
    });
    expect(link.getAttribute("href")).toBe("/admin/users");
  });

  it("uses the singular for one account", async () => {
    countPendingAccounts.mockResolvedValue(1);
    render(await AdminOverview());
    expect(
      screen.getByRole("link", { name: /1 account waiting for approval/i }),
    ).toBeTruthy();
  });

  it("shows no notice when nobody is waiting", async () => {
    countPendingAccounts.mockResolvedValue(0);
    render(await AdminOverview());
    expect(screen.queryByText(/waiting for approval/i)).toBeNull();
  });
});
