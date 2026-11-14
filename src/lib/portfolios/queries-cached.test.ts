import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Table-aware double: each `from(table)` chain resolves to that table's rows
// whichever call ends it, and every filter is recorded per table so tests can
// assert the tenant/limit arguments. Tables read by listReadableBoardsCached:
//  org_members, boards, board_members, folder_members, folder_boards.
type Call = [table: string, method: string, ...args: unknown[]];
let tables: Record<string, unknown[]> = {};
let calls: Call[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const result = { data: tables[table] ?? [], error: null };
      const qb: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "limit", "order"]) {
        qb[m] = (...args: unknown[]) => {
          calls.push([table, m, ...args]);
          return qb;
        };
      }
      qb.then = (onFulfilled: (r: typeof result) => unknown) =>
        Promise.resolve(result).then(onFulfilled);
      return qb;
    },
  }),
}));

import { cacheTag } from "next/cache";
import { listReadableBoardsCached } from "./queries-cached";
import { READABLE_BOARDS_LIMIT } from "./queries";

const gb = (id: string, name: string, ws: string, orgId: string) => ({
  id,
  name,
  workspace_id: ws,
  org_id: orgId,
});

beforeEach(() => {
  tables = {};
  calls = [];
  vi.mocked(cacheTag).mockClear();
});

describe("listReadableBoardsCached", () => {
  it("replicates the RLS policy: active membership + (creator OR grant), bounded, deduped, name-sorted", async () => {
    tables = {
      org_members: [{ org_id: "org-1" }],
      boards: [
        { id: "b2", name: "Zeta", workspace_id: "ws1" },
        { id: "b1", name: "Alpha", workspace_id: "ws1" },
      ],
      // duplicate of an owned board + a granted board + a foreign-org grant
      board_members: [
        { boards: gb("b1", "Alpha", "ws1", "org-1") },
        { boards: gb("b3", "Mid", "ws2", "org-1") },
        { boards: gb("bX", "Foreign", "wsX", "org-OTHER") },
      ],
    };

    const boards = await listReadableBoardsCached("u1");

    expect(calls).toContainEqual(["org_members", "eq", "user_id", "u1"]);
    expect(calls).toContainEqual(["org_members", "is", "deactivated_at", null]);
    expect(calls).toContainEqual(["boards", "eq", "created_by", "u1"]);
    expect(calls).toContainEqual(["boards", "in", "org_id", ["org-1"]]);
    expect(calls).toContainEqual(["boards", "limit", READABLE_BOARDS_LIMIT]);
    expect(calls).toContainEqual(["board_members", "eq", "user_id", "u1"]);
    expect(calls).toContainEqual([
      "board_members",
      "limit",
      READABLE_BOARDS_LIMIT,
    ]);
    expect(boards).toEqual([
      { id: "b1", name: "Alpha", workspaceId: "ws1" },
      { id: "b3", name: "Mid", workspaceId: "ws2" },
      { id: "b2", name: "Zeta", workspaceId: "ws1" },
    ]);
  });

  it("returns [] for a user with no active org membership", async () => {
    tables = { org_members: [] };
    expect(await listReadableBoardsCached("u1")).toEqual([]);
    expect(calls.some((c) => c[0] !== "org_members")).toBe(false);
  });

  it("includes a board reached only through a folder the user is a member of", async () => {
    tables = {
      org_members: [{ org_id: "org-1" }],
      folder_members: [{ folder_id: "f1", org_id: "org-1" }],
      folder_boards: [
        { folder_id: "f1", boards: gb("b9", "Plan", "ws1", "org-1") },
      ],
    };

    expect(await listReadableBoardsCached("u1")).toEqual([
      { id: "b9", name: "Plan", workspaceId: "ws1" },
    ]);
    expect(calls).toContainEqual(["folder_members", "eq", "user_id", "u1"]);
    expect(calls).toContainEqual(["folder_members", "in", "org_id", ["org-1"]]);
    expect(calls).toContainEqual(["folder_boards", "in", "folder_id", ["f1"]]);
    expect(calls).toContainEqual([
      "folder_boards",
      "limit",
      READABLE_BOARDS_LIMIT,
    ]);
  });

  it("ignores a folder membership in an org the user is no longer active in", async () => {
    tables = {
      org_members: [{ org_id: "org-1" }],
      folder_members: [{ folder_id: "f1", org_id: "org-OLD" }],
      folder_boards: [
        { folder_id: "f1", boards: gb("b9", "Plan", "ws1", "org-OLD") },
      ],
    };

    expect(await listReadableBoardsCached("u1")).toEqual([]);
    expect(calls.some((c) => c[0] === "folder_boards")).toBe(false);
  });

  it("ignores a folder placement whose board sits in a different org than the membership", async () => {
    tables = {
      org_members: [{ org_id: "org-1" }, { org_id: "org-2" }],
      folder_members: [{ folder_id: "f1", org_id: "org-1" }],
      folder_boards: [
        { folder_id: "f1", boards: gb("b9", "Plan", "ws1", "org-2") },
      ],
    };

    expect(await listReadableBoardsCached("u1")).toEqual([]);
  });

  it("is tagged with every invalidation that changes the set", async () => {
    await listReadableBoardsCached("u1");
    expect(cacheTag).toHaveBeenCalledWith(
      "boards:user:u1",
      "shared-boards:user:u1",
      "folder-members:user:u1",
    );
  });
});
