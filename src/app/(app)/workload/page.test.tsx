import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActiveOrgId, isOrgAdmin, isOrgAdminCached } = vi.hoisted(() => ({
  getActiveOrgId: vi.fn(),
  isOrgAdmin: vi.fn(),
  isOrgAdminCached: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/org/active", () => ({
  getActiveOrgId: () => getActiveOrgId(),
}));
vi.mock("@/lib/org/guard", () => ({
  isOrgAdmin: () => isOrgAdmin(),
  isOrgAdminCached: (userId: string, orgId: string) =>
    isOrgAdminCached(userId, orgId),
}));
vi.mock("@/lib/workload/queries", () => ({
  getWorkloadPageData: async () => ({
    rawRows: [],
    actuals: [],
    members: [],
    capacities: [],
    defaults: null,
    boards: [],
    workspaces: [],
    today: "2026-01-01",
    weeksBack: 0,
    weeksFwd: 0,
    weekStartsOn: 1,
  }),
}));
vi.mock("@/components/workload/WorkloadGrid", () => ({
  WorkloadGrid: () => null,
}));

import WorkloadPage from "./page";

const render = async () =>
  (
    (await WorkloadPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ isOrgAdmin: boolean; currentUserId: string }>
  ).props;

beforeEach(() => {
  vi.clearAllMocks();
  getActiveOrgId.mockResolvedValue("o1");
  isOrgAdminCached.mockResolvedValue(true);
});

describe("WorkloadPage — admin flag", () => {
  it("reads the cached role lookup for this user and the active org, never the members RPC", async () => {
    const props = await render();

    expect(isOrgAdminCached).toHaveBeenCalledWith("u1", "o1");
    expect(isOrgAdmin).not.toHaveBeenCalled();
    expect(props.isOrgAdmin).toBe(true);
  });

  it("passes a non-admin through as false", async () => {
    isOrgAdminCached.mockResolvedValue(false);

    expect((await render()).isOrgAdmin).toBe(false);
  });

  it("fails closed with no active org, without a lookup", async () => {
    getActiveOrgId.mockResolvedValue("");

    expect((await render()).isOrgAdmin).toBe(false);
    expect(isOrgAdminCached).not.toHaveBeenCalled();
  });
});
