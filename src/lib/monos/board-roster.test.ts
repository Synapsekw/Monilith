import { describe, expect, it, vi } from "vitest";

const listOrgMembersCached = vi.fn(async (_orgId: string) => [
  { userId: "u1", fullName: "Ada", email: null, avatarUrl: null },
]);
const listOrgMonosCached = vi.fn(async (_orgId: string) => [
  { userId: "m1", ownerId: "u1", name: "Nova", color: "#7395ff" },
]);
const getMyMono = vi.fn();
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: (id: string) => listOrgMembersCached(id),
}));
vi.mock("./queries-cached", () => ({
  listOrgMonosCached: (id: string) => listOrgMonosCached(id),
}));
vi.mock("./queries", () => ({
  getMyMono: (...a: unknown[]) => getMyMono(...a),
}));

import { loadBoardRoster } from "./board-roster";

describe("loadBoardRoster", () => {
  it("reads people, Monos and the viewer's own Mono for one org", async () => {
    getMyMono.mockResolvedValueOnce(null);
    const roster = await loadBoardRoster({} as never, "o1");
    expect(listOrgMembersCached).toHaveBeenCalledWith("o1");
    expect(listOrgMonosCached).toHaveBeenCalledWith("o1");
    expect(roster.orgId).toBe("o1");
    expect(roster.monos).toHaveLength(1);
    expect(roster.myMono).toBeNull();
  });

  it("never fails the page when the viewer's Mono read fails", async () => {
    getMyMono.mockRejectedValueOnce(new Error("rpc down"));
    const roster = await loadBoardRoster({} as never, "o1");
    expect(roster.myMono).toBeNull();
  });
  it("never fails the page when the org's Monos read fails", async () => {
    getMyMono.mockResolvedValueOnce(null);
    listOrgMonosCached.mockRejectedValueOnce(new Error("cache down"));
    const roster = await loadBoardRoster({} as never, "o1");
    expect(roster.monos).toEqual([]);
    expect(roster.members).toHaveLength(1);
  });
});
