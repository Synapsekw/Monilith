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
vi.mock("server-only", () => ({}));
const isGuest = { value: false };
vi.mock("@/lib/folders/access-cached", () => ({
  getFolderAccessForUserCached: vi.fn(async () => ({
    isGuest: isGuest.value,
    folderIds: [],
  })),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => []),
}));
vi.mock("@/lib/auth/session", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

/** The viewer's RLS-scoped client: returns the org_members rows they may read,
 *  applying the org filter. */
function viewerClient(rows: { org_id: string; user_id: string }[]) {
  return {
    from: () => {
      let org: string | null = null;
      const q = {
        select: () => q,
        eq(_c: string, v: string) {
          org = v;
          return q;
        },
        limit: async () => ({
          data: rows.filter((r) => r.org_id === org),
          error: null,
        }),
      };
      return q;
    },
  } as never;
}

import { loadBoardRoster } from "./board-roster";

describe("loadBoardRoster", () => {
  it("reads people, Monos and the viewer's own Mono for one org", async () => {
    getMyMono.mockResolvedValueOnce(null);
    const roster = await loadBoardRoster({} as never, "o1", "u1");
    expect(listOrgMembersCached).toHaveBeenCalledWith("o1");
    expect(listOrgMonosCached).toHaveBeenCalledWith("o1");
    expect(roster.orgId).toBe("o1");
    expect(roster.monos).toHaveLength(1);
    expect(roster.myMono).toBeNull();
  });

  it("never fails the page when the viewer's Mono read fails", async () => {
    getMyMono.mockRejectedValueOnce(new Error("rpc down"));
    const roster = await loadBoardRoster({} as never, "o1", "u1");
    expect(roster.myMono).toBeNull();
  });
  it("never fails the page when the org's Monos read fails", async () => {
    getMyMono.mockResolvedValueOnce(null);
    listOrgMonosCached.mockRejectedValueOnce(new Error("cache down"));
    const roster = await loadBoardRoster({} as never, "o1", "u1");
    expect(roster.monos).toEqual([]);
    expect(roster.members).toHaveLength(1);
  });

  it("gives a guest only the people and Monos they may see", async () => {
    isGuest.value = true;
    getMyMono.mockResolvedValue(null);
    try {
      // The guest (u9) shares nothing with u1 in o1: neither u1 nor u1's Mono.
      const alone = await loadBoardRoster(
        viewerClient([
          { org_id: "o1", user_id: "u9" },
          { org_id: "o2", user_id: "u1" },
          { org_id: "o2", user_id: "m1" },
        ]),
        "o1",
        "u9",
      );
      expect(alone.members).toEqual([]);
      expect(alone.monos).toEqual([]);
      // Sharing a board with u1 and the Mono on it makes both visible.
      const shared = await loadBoardRoster(
        viewerClient([
          { org_id: "o1", user_id: "u9" },
          { org_id: "o1", user_id: "u1" },
          { org_id: "o1", user_id: "m1" },
        ]),
        "o1",
        "u9",
      );
      expect(shared.members.map((m) => m.userId)).toEqual(["u1"]);
      expect(shared.monos.map((m) => m.userId)).toEqual(["m1"]);
    } finally {
      isGuest.value = false;
    }
  });
});
