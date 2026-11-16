import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isActiveOrgGuest, getGoalsTree } = vi.hoisted(() => ({
  isActiveOrgGuest: vi.fn(),
  getGoalsTree: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/org/guest", () => ({
  isActiveOrgGuest: (userId: string) => isActiveOrgGuest(userId),
}));
vi.mock("@/lib/goals/queries", () => ({
  getGoalsTree: () => getGoalsTree(),
  getGoalOwners: async () => new Map(),
  listReadableBoardsCached: async () => [],
  getGoalLinks: async () => new Map(),
}));
vi.mock("@/components/goals/GoalsView", () => ({ GoalsView: () => null }));
vi.mock("@/components/goals/NewGoalDialog", () => ({
  NewGoalDialog: () => null,
}));

import GoalsIndex from "./page";
import { GuestUnavailable } from "@/components/shell/guest-unavailable";

beforeEach(() => {
  isActiveOrgGuest.mockReset().mockResolvedValue(false);
  getGoalsTree.mockReset().mockResolvedValue([]);
});

describe("GoalsIndex", () => {
  it("renders the not-available state for a guest and reads no goals", async () => {
    isActiveOrgGuest.mockResolvedValue(true);
    const el = (await GoalsIndex()) as ReactElement<{ title: string }>;
    expect(isActiveOrgGuest).toHaveBeenCalledWith("u1");
    expect(el.type).toBe(GuestUnavailable);
    expect(el.props.title).toBe("Goals");
    expect(getGoalsTree).not.toHaveBeenCalled();
  });

  it("renders the goals page for a full member", async () => {
    const el = (await GoalsIndex()) as ReactElement;
    expect(el.type).not.toBe(GuestUnavailable);
    expect(getGoalsTree).toHaveBeenCalledTimes(1);
  });
});
