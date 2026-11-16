import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isActiveOrgGuest, listReportsForOrg } = vi.hoisted(() => ({
  isActiveOrgGuest: vi.fn(),
  listReportsForOrg: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/org/guest", () => ({
  isActiveOrgGuest: (userId: string) => isActiveOrgGuest(userId),
}));
vi.mock("@/lib/org/active", () => ({ getActiveOrgId: async () => "o1" }));
vi.mock("@/lib/reports/queries", () => ({
  listReportsForOrg: (...a: unknown[]) => listReportsForOrg(...a),
  listReportTemplates: async () => [],
}));
vi.mock("@/components/reports/ReportsIndex", () => ({
  ReportsIndex: () => null,
}));

import ReportsIndexPage from "./page";
import { GuestUnavailable } from "@/components/shell/guest-unavailable";

beforeEach(() => {
  isActiveOrgGuest.mockReset().mockResolvedValue(false);
  listReportsForOrg.mockReset().mockResolvedValue([]);
});

describe("ReportsIndexPage", () => {
  it("renders the not-available state for a guest and reads no reports", async () => {
    isActiveOrgGuest.mockResolvedValue(true);
    const el = (await ReportsIndexPage()) as ReactElement<{ title: string }>;
    expect(isActiveOrgGuest).toHaveBeenCalledWith("u1");
    expect(el.type).toBe(GuestUnavailable);
    expect(el.props.title).toBe("Reports");
    expect(listReportsForOrg).not.toHaveBeenCalled();
  });

  it("renders the index for a full member", async () => {
    const el = (await ReportsIndexPage()) as ReactElement;
    expect(el.type).not.toBe(GuestUnavailable);
    expect(listReportsForOrg).toHaveBeenCalledTimes(1);
  });
});
