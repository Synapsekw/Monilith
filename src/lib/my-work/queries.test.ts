import { describe, expect, it, vi } from "vitest";

const { getUser, resolveActiveOrg, getUserTimeZoneCached, rpc } = vi.hoisted(
  () => ({
    getUser: vi.fn(),
    resolveActiveOrg: vi.fn(),
    getUserTimeZoneCached: vi.fn(),
    rpc: vi.fn(),
  }),
);
vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/profile/queries-cached", () => ({
  getUserTimeZoneCached: (id: string) => getUserTimeZoneCached(id),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

import {
  getMyWorkItems,
  getMyWorkItemsCore,
  getMyWorkPageData,
  MY_WORK_ITEM_LIMIT,
} from "./queries";

type Row = {
  item_id: string;
  item_name: string;
  board_id: string;
  board_name: string | null;
  group_name: string | null;
  due_date: string | null;
  status_label: string | null;
  status_color: string | null;
  org_id: string;
};

const ROW: Row = {
  item_id: "i1",
  item_name: "Ship it",
  board_id: "b1",
  board_name: "Launch",
  group_name: "Sprint 1",
  due_date: "2026-07-10",
  status_label: "Working on it",
  status_color: "#e8a33d",
  org_id: "o1",
};

/** The RPC returns one org's open items: the double applies p_org_id and p_limit. */
function serveRows(rows: Row[]) {
  rpc.mockImplementation(
    async (_fn: string, a: { p_org_id: string; p_limit: number }) => ({
      data: rows
        .filter((r) => r.org_id === a.p_org_id)
        .slice(0, a.p_limit)
        .map((r) => {
          const { org_id, ...rest } = r;
          void org_id;
          return rest;
        }),
      error: null,
    }),
  );
}

describe("getMyWorkItems (RPC)", () => {
  it("returns [] for a logged-out caller without calling the RPC", async () => {
    rpc.mockReset();
    getUser.mockResolvedValue(null);
    expect(await getMyWorkItems()).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns [] when the user has no active org, without calling the RPC", async () => {
    rpc.mockReset();
    getUser.mockResolvedValue({ id: "u1" });
    resolveActiveOrg.mockResolvedValue(null);
    expect(await getMyWorkItems()).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fetches the ACTIVE org in ONE rpc call and maps to MyWorkItem", async () => {
    rpc.mockReset();
    getUser.mockResolvedValue({ id: "u1" });
    resolveActiveOrg.mockResolvedValue({ id: "o1" });
    serveRows([ROW, { ...ROW, item_id: "other-org", org_id: "o2" }]);
    const items = await getMyWorkItems();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_my_open_work", {
      p_org_id: "o1",
      p_limit: MY_WORK_ITEM_LIMIT,
    });
    expect(items).toEqual([
      {
        itemId: "i1",
        itemName: "Ship it",
        boardId: "b1",
        boardName: "Launch",
        groupName: "Sprint 1",
        status: { label: "Working on it", color: "#e8a33d" },
        dueDate: "2026-07-10",
      },
    ]);
  });

  it("degrades gracefully: no status, missing board name, rpc error", async () => {
    rpc.mockReset();
    getUser.mockResolvedValue({ id: "u1" });
    resolveActiveOrg.mockResolvedValue({ id: "o1" });
    serveRows([
      {
        ...ROW,
        board_name: null,
        group_name: null,
        due_date: null,
        status_label: null,
        status_color: null,
      },
    ]);
    expect(await getMyWorkItems()).toEqual([
      {
        itemId: "i1",
        itemName: "Ship it",
        boardId: "b1",
        boardName: "Unknown board",
        groupName: null,
        status: null,
        dueDate: null,
      },
    ]);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await getMyWorkItems()).toEqual([]);
  });
});

describe("getMyWorkItemsCore", () => {
  const client = { rpc } as never;

  it("passes the org and the caller's limit, and keeps the RPC's order", async () => {
    rpc.mockReset();
    serveRows([
      { ...ROW, item_id: "first", due_date: "2026-01-01" },
      { ...ROW, item_id: "second", due_date: "2026-02-01" },
      { ...ROW, item_id: "third", due_date: null },
    ]);
    const result = await getMyWorkItemsCore(client, { orgId: "o1", limit: 2 });
    expect(rpc).toHaveBeenCalledWith("get_my_open_work", {
      p_org_id: "o1",
      p_limit: 2,
    });
    expect(result.ok && result.items.map((i) => i.itemId)).toEqual([
      "first",
      "second",
    ]);
  });

  it("returns ok:false with the message instead of an empty list on failure", async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await getMyWorkItemsCore(client, { orgId: "o1" })).toEqual({
      ok: false,
      error: "boom",
    });
  });
});

describe("getMyWorkPageData", () => {
  it("buckets by the member's own 'today', not the server's", async () => {
    rpc.mockReset();
    getUser.mockResolvedValue({ id: "u1" });
    resolveActiveOrg.mockResolvedValue({ id: "o1" });
    getUserTimeZoneCached.mockResolvedValue("Asia/Tokyo");
    serveRows([{ ...ROW, due_date: "2026-11-14" }]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 14, 22, 30)); // the 15th in Tokyo
    try {
      const { today, groups } = await getMyWorkPageData();
      expect(getUserTimeZoneCached).toHaveBeenCalledWith("u1");
      expect(today).toBe("2026-11-15");
      expect(groups.map((g) => g.bucket)).toEqual(["overdue"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the UTC date when the member has no zone", async () => {
    rpc.mockReset();
    getUser.mockResolvedValue({ id: "u1" });
    resolveActiveOrg.mockResolvedValue({ id: "o1" });
    getUserTimeZoneCached.mockResolvedValue(null);
    serveRows([]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 14, 22, 30));
    try {
      const { today, groups } = await getMyWorkPageData();
      expect(today).toBe("2026-11-14");
      expect(groups).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
