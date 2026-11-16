import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUser,
  resolveActiveOrg,
  getUserTimeZoneCached,
  rpc,
  getFocusTodayCore,
  requireAiEntitlement,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
  getUserTimeZoneCached: vi.fn(),
  rpc: vi.fn(),
  getFocusTodayCore: vi.fn(),
  requireAiEntitlement: vi.fn(),
}));
vi.mock("@/lib/focus/queries", () => ({
  FOCUS_MAX_LIMIT: 50,
  getFocusTodayCore: (...a: unknown[]) => getFocusTodayCore(...a),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...a: unknown[]) => requireAiEntitlement(...a),
}));
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

// Unless a test arranges otherwise, focus and the entitlement are inert, so the
// pre-existing page tests keep exercising the list alone.
beforeEach(() => {
  getFocusTodayCore.mockReset();
  getFocusTodayCore.mockResolvedValue({ ok: false, error: "unarranged" });
  requireAiEntitlement.mockReset();
  requireAiEntitlement.mockResolvedValue(undefined);
});

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

  it("uses the org's zone when the member has none (review I5)", async () => {
    rpc.mockReset();
    getUser.mockResolvedValue({ id: "u1" });
    resolveActiveOrg.mockResolvedValue({ id: "o1", timezone: "Asia/Tokyo" });
    getUserTimeZoneCached.mockResolvedValue(null);
    serveRows([{ ...ROW, due_date: "2026-11-14" }]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 14, 22, 30)); // the 15th in Tokyo
    try {
      const { today, groups } = await getMyWorkPageData();
      expect(today).toBe("2026-11-15");
      expect(groups.map((g) => g.bucket)).toEqual(["overdue"]);
      expect(getFocusTodayCore.mock.calls[0][1]).toMatchObject({
        orgTimeZone: "Asia/Tokyo",
      });
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

describe("getMyWorkPageData focus and ask", () => {
  const FOCUS = {
    today: "2026-11-14",
    timezoneAssumed: false,
    items: [],
    totals: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    ordering: "current",
  };

  function arrange() {
    rpc.mockReset();
    getFocusTodayCore.mockReset();
    requireAiEntitlement.mockReset();
    getUser.mockResolvedValue({ id: "u1" });
    resolveActiveOrg.mockResolvedValue({ id: "o1" });
    getUserTimeZoneCached.mockResolvedValue("UTC");
    serveRows([ROW]);
    requireAiEntitlement.mockResolvedValue(undefined);
  }

  it("returns the focus result and asks it for this org and user", async () => {
    arrange();
    getFocusTodayCore.mockResolvedValue({ ok: true, data: FOCUS });
    const page = await getMyWorkPageData();
    expect(page.focus).toBe(FOCUS);
    expect(getFocusTodayCore).toHaveBeenCalledTimes(1);
    expect(getFocusTodayCore.mock.calls[0][1]).toEqual({
      orgId: "o1",
      userId: "u1",
      orgTimeZone: null,
      // The function's own maximum: "Show more" reveals rows from memory.
      limit: 50,
    });
  });

  it("returns focus null when the focus read fails but still returns the list", async () => {
    arrange();
    getFocusTodayCore.mockResolvedValue({ ok: false, error: "boom" });
    const page = await getMyWorkPageData();
    expect(page.focus).toBeNull();
    expect(page.groups.flatMap((g) => g.items.map((i) => i.itemId))).toEqual([
      "i1",
    ]);
  });

  it("canAsk is true when the entitlement check passes, for the ask_pulse feature", async () => {
    arrange();
    getFocusTodayCore.mockResolvedValue({ ok: true, data: FOCUS });
    expect((await getMyWorkPageData()).canAsk).toBe(true);
    expect(requireAiEntitlement).toHaveBeenCalledWith("o1", "ask_pulse");
  });

  it("canAsk is false when the entitlement check throws, and the page still renders", async () => {
    arrange();
    getFocusTodayCore.mockResolvedValue({ ok: true, data: FOCUS });
    requireAiEntitlement.mockRejectedValue(new Error("disabled"));
    const page = await getMyWorkPageData();
    expect(page.canAsk).toBe(false);
    expect(page.focus).toBe(FOCUS);
  });

  it("makes no focus or entitlement call for a logged-out caller", async () => {
    arrange();
    getUser.mockResolvedValue(null);
    const page = await getMyWorkPageData();
    expect(page).toMatchObject({ groups: [], focus: null, canAsk: false });
    expect(getFocusTodayCore).not.toHaveBeenCalled();
    expect(requireAiEntitlement).not.toHaveBeenCalled();
  });
});
