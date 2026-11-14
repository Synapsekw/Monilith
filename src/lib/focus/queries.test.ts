import { describe, expect, it, vi } from "vitest";
import { getFocusTodayCore, FOCUS_LIMIT } from "./queries";

type Row = Record<string, unknown>;

/**
 * PostgREST double that models every filter the handler applies: `.eq`,
 * `.neq`, `.lt`, `.in`, `.is(col, null)`, `.order` and `.limit` all act on the
 * rows, so dropping any of them in the handler changes what comes back.
 */
function client(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
) {
  const calls: { table: string; eq: Record<string, unknown> }[] = [];
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const neq: [string, unknown][] = [];
    const lt: [string, string][] = [];
    const isNull: string[] = [];
    let inFilter: { k: string; vs: unknown[] } | null = null;
    let order: { k: string; asc: boolean } | null = null;
    let max = Infinity;
    calls.push({ table, eq });
    const rows = () => {
      let out = (tables[table] ?? [])
        .filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v))
        .filter((r) => neq.every(([k, v]) => r[k] !== v))
        .filter((r) => lt.every(([k, v]) => String(r[k]) < v))
        .filter((r) => isNull.every((k) => r[k] == null))
        .filter((r) => !inFilter || inFilter.vs.includes(r[inFilter.k]));
      if (order) {
        const { k, asc } = order;
        out = [...out].sort((a, b) =>
          String(a[k]) < String(b[k]) ? (asc ? -1 : 1) : asc ? 1 : -1,
        );
      }
      return out.slice(0, max);
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        eq[k] = v;
        return q;
      },
      neq: (k: string, v: unknown) => {
        neq.push([k, v]);
        return q;
      },
      lt: (k: string, v: string) => {
        lt.push([k, v]);
        return q;
      },
      is: (k: string) => {
        isNull.push(k);
        return q;
      },
      in: (k: string, vs: unknown[]) => {
        inFilter = { k, vs };
        return q;
      },
      order: (k: string, o?: { ascending?: boolean }) => {
        order = { k, asc: o?.ascending ?? true };
        return q;
      },
      limit: (n: number) => {
        max = n;
        return q;
      },
      maybeSingle: async () =>
        errors[table]
          ? { data: null, error: { message: errors[table] } }
          : { data: rows()[0] ?? null, error: null },
      then: (resolve: (v: { data: Row[] | null; error: unknown }) => unknown) =>
        resolve(
          errors[table]
            ? { data: null, error: { message: errors[table] } }
            : { data: rows(), error: null },
        ),
    };
    return q;
  };
  return { supabase: { from } as never, calls };
}

const ROW = {
  item_id: "i1",
  item_name: "Ship the API",
  board_id: "b1",
  board_name: "Roadmap",
  group_name: "Sprint 4",
  status_label: "Working",
  due_date: "2026-11-10",
  tier: 1,
  days_overdue: 4,
  waiting_count: 1,
  waiting: [{ itemId: "i9", name: "Vendor contract", assigneeIds: ["u2"] }],
  unread_count: 0,
  days_quiet: 2,
  tier_total: 6,
};

// 2026-11-14T22:30:00Z; Tokyo is already on the 15th.
const NOW = Date.UTC(2026, 10, 14, 22, 30);

function fixture(rows: unknown[], tz: string | null) {
  const { supabase } = client({
    profiles: [
      { id: "u1", timezone: tz, full_name: "Me", avatar_url: null },
      { id: "u2", timezone: null, full_name: "Ana Kovac", avatar_url: null },
    ],
    org_members: [
      { org_id: "o1", user_id: "u1" },
      { org_id: "o1", user_id: "u2" },
    ],
  });
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  return { supabase: { ...(supabase as object), rpc } as never, rpc };
}

describe("getFocusTodayCore", () => {
  it("passes the member's local date and the stall constant to the RPC", async () => {
    const { supabase, rpc } = fixture([ROW], "Asia/Tokyo");
    await getFocusTodayCore(supabase, { orgId: "o1", userId: "u1", now: NOW });
    expect(rpc).toHaveBeenCalledWith("get_focus_today", {
      p_org_id: "o1",
      p_today: "2026-11-15",
      p_folder_id: null,
      p_stall_days: 5,
      p_limit: FOCUS_LIMIT,
    });
  });

  it("uses the org's zone when the member has none (review I5)", async () => {
    const { supabase, rpc } = fixture([], null);
    const res = await getFocusTodayCore(supabase, {
      orgId: "o1",
      userId: "u1",
      orgTimeZone: "Asia/Tokyo",
      now: NOW,
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_focus_today",
      expect.objectContaining({ p_today: "2026-11-15" }),
    );
    expect(res.ok && res.data.timezoneAssumed).toBe(false);
  });

  it("the member's own zone wins over the org's", async () => {
    const { supabase, rpc } = fixture([], "UTC");
    await getFocusTodayCore(supabase, {
      orgId: "o1",
      userId: "u1",
      orgTimeZone: "Asia/Tokyo",
      now: NOW,
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_focus_today",
      expect.objectContaining({ p_today: "2026-11-14" }),
    );
  });

  it("maps rows, resolves waiting names and reports totals per tier", async () => {
    const { supabase } = fixture([ROW], null);
    const res = await getFocusTodayCore(supabase, {
      orgId: "o1",
      userId: "u1",
      now: NOW,
    });
    expect(res).toEqual({
      ok: true,
      data: {
        today: "2026-11-14",
        timezoneAssumed: true,
        items: [
          {
            itemId: "i1",
            itemName: "Ship the API",
            boardId: "b1",
            boardName: "Roadmap",
            groupName: "Sprint 4",
            status: "Working",
            dueDate: "2026-11-10",
            tier: 1,
            reason:
              '4 days overdue · Ana Kovac\'s "Vendor contract" waits on this',
          },
        ],
        totals: { 1: 6, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
    });
  });

  describe("totals when the limit cuts the list (deferred minor m1)", () => {
    const row = (id: string, tier: number, total: number) => ({
      ...ROW,
      item_id: id,
      tier,
      tier_total: total,
      waiting: [],
      waiting_count: 0,
    });

    it("a full list reports tiers after the last returned tier as unknown", async () => {
      const { supabase } = fixture([row("a", 1, 6), row("b", 2, 4)], null);
      const res = await getFocusTodayCore(supabase, {
        orgId: "o1",
        userId: "u1",
        limit: 2,
        now: NOW,
      });
      expect(res.ok && res.data.totals).toEqual({
        1: 6,
        2: 4,
        3: null,
        4: null,
        5: null,
      });
    });

    it("tiers before the last returned one are truly empty, so 0", async () => {
      const { supabase } = fixture([row("a", 3, 9), row("b", 3, 9)], null);
      const res = await getFocusTodayCore(supabase, {
        orgId: "o1",
        userId: "u1",
        limit: 2,
        now: NOW,
      });
      expect(res.ok && res.data.totals).toEqual({
        1: 0,
        2: 0,
        3: 9,
        4: null,
        5: null,
      });
    });

    it("a list shorter than the limit is complete, so missing tiers are 0", async () => {
      const { supabase } = fixture([row("a", 2, 1)], null);
      const res = await getFocusTodayCore(supabase, {
        orgId: "o1",
        userId: "u1",
        limit: 2,
        now: NOW,
      });
      expect(res.ok && res.data.totals).toEqual({
        1: 0,
        2: 1,
        3: 0,
        4: 0,
        5: 0,
      });
    });
  });

  it("fails closed on a row that does not match the schema", async () => {
    const { supabase } = fixture([{ ...ROW, tier: 9 }], null);
    const res = await getFocusTodayCore(supabase, {
      orgId: "o1",
      userId: "u1",
      now: NOW,
    });
    expect(res.ok).toBe(false);
  });

  it("returns the RPC error message", async () => {
    const { supabase } = fixture([], null);
    (supabase as { rpc: unknown }).rpc = vi.fn(async () => ({
      data: null,
      error: { message: "connection reset" },
    }));
    const res = await getFocusTodayCore(supabase, {
      orgId: "o1",
      userId: "u1",
      now: NOW,
    });
    expect(res).toEqual({ ok: false, error: "connection reset" });
  });
});
