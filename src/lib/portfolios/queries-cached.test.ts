import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Three query shapes:
//  org_members:  select("org_id").eq("user_id", …).is("deactivated_at", null)
//  boards:       select(…).eq("created_by", …).in("org_id", …).limit(…)
//  board_members: select("boards!inner(…)").eq("user_id", …).limit(…)
const orgIs = vi.fn();
const orgEq = vi.fn(() => ({ is: orgIs }));
const orgSelect = vi.fn(() => ({ eq: orgEq }));

const ownLimit = vi.fn();
const ownIn = vi.fn(() => ({ limit: ownLimit }));
const ownEq = vi.fn(() => ({ in: ownIn }));
const ownSelect = vi.fn(() => ({ eq: ownEq }));

const sharedLimit = vi.fn();
const sharedEq = vi.fn(() => ({ limit: sharedLimit }));
const sharedSelect = vi.fn(() => ({ eq: sharedEq }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === "org_members"
        ? { select: orgSelect }
        : table === "boards"
          ? { select: ownSelect }
          : { select: sharedSelect },
  }),
}));

import { listReadableBoardsCached } from "./queries-cached";
import { READABLE_BOARDS_LIMIT } from "./queries";

beforeEach(() => {
  [
    orgSelect,
    orgEq,
    orgIs,
    ownSelect,
    ownEq,
    ownIn,
    ownLimit,
    sharedSelect,
    sharedEq,
    sharedLimit,
  ].forEach((m) => m.mockReset());
  orgEq.mockReturnValue({ is: orgIs });
  ownEq.mockReturnValue({ in: ownIn });
  ownIn.mockReturnValue({ limit: ownLimit });
  sharedEq.mockReturnValue({ limit: sharedLimit });
  orgSelect.mockReturnValue({ eq: orgEq });
  ownSelect.mockReturnValue({ eq: ownEq });
  sharedSelect.mockReturnValue({ eq: sharedEq });
});

describe("listReadableBoardsCached", () => {
  it("replicates the RLS policy: active membership + (creator OR grant), bounded, deduped, name-sorted", async () => {
    orgIs.mockResolvedValue({ data: [{ org_id: "org-1" }], error: null });
    ownLimit.mockResolvedValue({
      data: [
        { id: "b2", name: "Zeta", workspace_id: "ws1" },
        { id: "b1", name: "Alpha", workspace_id: "ws1" },
      ],
      error: null,
    });
    sharedLimit.mockResolvedValue({
      data: [
        // duplicate of an owned board + a granted board + a foreign-org grant
        {
          boards: {
            id: "b1",
            name: "Alpha",
            workspace_id: "ws1",
            org_id: "org-1",
          },
        },
        {
          boards: {
            id: "b3",
            name: "Mid",
            workspace_id: "ws2",
            org_id: "org-1",
          },
        },
        {
          boards: {
            id: "bX",
            name: "Foreign",
            workspace_id: "wsX",
            org_id: "org-OTHER",
          },
        },
      ],
      error: null,
    });

    const boards = await listReadableBoardsCached("u1");
    expect(orgEq).toHaveBeenCalledWith("user_id", "u1");
    expect(orgIs).toHaveBeenCalledWith("deactivated_at", null);
    expect(ownEq).toHaveBeenCalledWith("created_by", "u1");
    expect(ownIn).toHaveBeenCalledWith("org_id", ["org-1"]);
    expect(ownLimit).toHaveBeenCalledWith(READABLE_BOARDS_LIMIT);
    expect(sharedEq).toHaveBeenCalledWith("user_id", "u1");
    expect(sharedLimit).toHaveBeenCalledWith(READABLE_BOARDS_LIMIT);
    expect(boards).toEqual([
      { id: "b1", name: "Alpha", workspaceId: "ws1" },
      { id: "b3", name: "Mid", workspaceId: "ws2" },
      { id: "b2", name: "Zeta", workspaceId: "ws1" },
    ]);
  });

  it("returns [] for a user with no active org membership", async () => {
    orgIs.mockResolvedValue({ data: [], error: null });
    expect(await listReadableBoardsCached("u1")).toEqual([]);
    expect(ownSelect).not.toHaveBeenCalled();
  });
});
