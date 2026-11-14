import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// Table-aware double. `org_members` ends in `.maybeSingle()` (one row or null);
// `folder_members` ends in `.limit()`, which for the hot path is preceded by
// `.order()`. Every filter is recorded per table.
type Call = [table: string, method: string, ...args: unknown[]];
type Res = { data: unknown; error: { message: string } | null };
let results: Record<string, Res> = {};
let calls: Call[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const res = results[table] ?? { data: null, error: null };
      const qb: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "limit", "order"]) {
        qb[m] = (...args: unknown[]) => {
          calls.push([table, m, ...args]);
          return qb;
        };
      }
      qb.maybeSingle = () => Promise.resolve(res);
      qb.then = (onFulfilled: (r: Res) => unknown) =>
        Promise.resolve(res).then(onFulfilled);
      return qb;
    },
  }),
}));

import { cacheLife, cacheTag } from "next/cache";
import { getFolderAccessForUserCached } from "./access-cached";

const ok = (data: unknown): Res => ({ data, error: null });
const boom: Res = { data: null, error: { message: "db down" } };

beforeEach(() => {
  results = {};
  calls = [];
  vi.mocked(cacheTag).mockClear();
  vi.mocked(cacheLife).mockClear();
});

describe("getFolderAccessForUserCached", () => {
  it("gives a guest exactly the folders they are a member of", async () => {
    results = {
      org_members: ok({ role: "guest" }),
      folder_members: ok([{ folder_id: "f1" }, { folder_id: "f2" }]),
    };
    expect(await getFolderAccessForUserCached("u1", "o1")).toEqual({
      isGuest: true,
      folderIds: ["f1", "f2"],
    });
  });

  it("gives a guest with no folder rows no folders", async () => {
    results = { org_members: ok({ role: "guest" }), folder_members: ok([]) };
    expect(await getFolderAccessForUserCached("u1", "o1")).toEqual({
      isGuest: true,
      folderIds: [],
    });
  });

  it("does not confine a regular member", async () => {
    results = {
      org_members: ok({ role: "member" }),
      folder_members: ok([{ folder_id: "f1" }]),
    };
    const out = await getFolderAccessForUserCached("u1", "o1");
    expect(out.isGuest).toBe(false);
  });

  it("treats a deactivated member (no active row) as a guest with no folders", async () => {
    results = {
      org_members: ok(null),
      folder_members: ok([{ folder_id: "f1" }]),
    };
    expect(await getFolderAccessForUserCached("u1", "o1")).toEqual({
      isGuest: true,
      folderIds: [],
    });
  });

  it("fails closed when the role read errors", async () => {
    results = { org_members: boom, folder_members: ok([{ folder_id: "f1" }]) };
    expect(await getFolderAccessForUserCached("u1", "o1")).toEqual({
      isGuest: true,
      folderIds: [],
    });
  });

  it("returns no folders when the folder read errors", async () => {
    results = { org_members: ok({ role: "guest" }), folder_members: boom };
    expect(await getFolderAccessForUserCached("u1", "o1")).toEqual({
      isGuest: true,
      folderIds: [],
    });
  });

  it("filters both reads by user and org, and only the role read by active membership", async () => {
    results = { org_members: ok({ role: "member" }), folder_members: ok([]) };
    await getFolderAccessForUserCached("u1", "o1");
    for (const t of ["org_members", "folder_members"]) {
      expect(calls).toContainEqual([t, "eq", "user_id", "u1"]);
      expect(calls).toContainEqual([t, "eq", "org_id", "o1"]);
    }
    expect(calls).toContainEqual(["org_members", "is", "deactivated_at", null]);
    // Bounded and ordered by an indexed, stable key.
    expect(calls).toContainEqual(["folder_members", "limit", 500]);
    expect(calls).toContainEqual([
      "folder_members",
      "order",
      "folder_id",
      { ascending: true },
    ]);
  });

  it("is keyed per user and org through its tags and uses the nav lifetime", async () => {
    results = { org_members: ok({ role: "member" }), folder_members: ok([]) };
    await getFolderAccessForUserCached("u1", "o1");
    expect(cacheTag).toHaveBeenCalledWith(
      "folder-members:user:u1",
      "org-admin:user:u1:org:o1",
    );
    expect(cacheLife).toHaveBeenCalledWith("nav");
  });

  it("warns once, without user data, when the folder read hits its cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    results = {
      org_members: ok({ role: "guest" }),
      folder_members: ok(
        Array.from({ length: 500 }, (_, i) => ({ folder_id: `f${i}` })),
      ),
    };
    await getFolderAccessForUserCached("u1", "o1");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(
      "getFolderAccessForUserCached",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("u1");
    warn.mockRestore();
  });
});
