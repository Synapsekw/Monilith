import { describe, expect, it, vi } from "vitest";
import { getWorkloadSummaryCore } from "./queries";

const MEMBERS = [
  { userId: "u1", fullName: "Ada", avatarUrl: null },
  { userId: "u2", fullName: "Grace", avatarUrl: null },
  { userId: "u3", fullName: "Ida", avatarUrl: null },
];

/**
 * The real query is `.from(t).select(...).eq(...)`, then EITHER awaited
 * directly (member_capacity) OR chained with `.maybeSingle()`
 * (org_workload_settings). PostgrestFilterBuilder supports both — it's
 * thenable AND exposes further builder methods — so `eq()` here must return
 * an object that is itself awaitable while also carrying `.maybeSingle()`.
 */
function fakeClient(
  rawRows: unknown[],
  capacityRows: unknown[],
  defaults: unknown = null,
) {
  return {
    rpc: vi.fn(async () => ({ data: rawRows, error: null })),
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          const data = table === "member_capacity" ? capacityRows : [];
          const result = Promise.resolve({ data, error: null }) as Promise<{
            data: unknown;
            error: null;
          }> & { maybeSingle: () => Promise<{ data: unknown; error: null }> };
          result.maybeSingle = async () => ({ data: defaults, error: null });
          return result;
        },
      }),
    }),
  };
}

describe("getWorkloadSummaryCore", () => {
  it("sums estimates per member, joins their name, and counts null-estimate items with zero seconds", async () => {
    const client = fakeClient(
      [
        {
          item_id: "i1",
          board_id: "b1",
          item_name: "A",
          user_id: "u1",
          start_date: null,
          end_date: null,
          estimate_secs: 3600,
        },
        {
          item_id: "i2",
          board_id: "b1",
          item_name: "B",
          user_id: "u1",
          start_date: null,
          end_date: null,
          estimate_secs: 1800,
        },
        {
          item_id: "i3",
          board_id: "b1",
          item_name: "C",
          user_id: "u2",
          start_date: null,
          end_date: null,
          estimate_secs: null,
        },
      ],
      [{ user_id: "u1", hours_per_day: 8, working_days: [1, 2, 3, 4, 5] }],
    );

    const rows = await getWorkloadSummaryCore(client as never, {
      orgId: "o1",
      from: "2026-01-05",
      to: "2026-01-09",
      members: MEMBERS,
    });

    expect(rows).toHaveLength(3);

    const ada = rows.find((r) => r.userId === "u1");
    expect(ada?.allocatedSecs).toBe(5400);
    expect(ada?.itemCount).toBe(2);
    expect(ada?.name).toBe("Ada");

    // u2's single item has no estimate — counted, but contributes no seconds.
    const grace = rows.find((r) => r.userId === "u2");
    expect(grace?.allocatedSecs).toBe(0);
    expect(grace?.itemCount).toBe(1);
    expect(grace?.name).toBe("Grace");

    // u3 has no rollup rows at all — still appears, with zeroes, not omitted.
    const ida = rows.find((r) => r.userId === "u3");
    expect(ida).toBeDefined();
    expect(ida?.allocatedSecs).toBe(0);
    expect(ida?.itemCount).toBe(0);
    expect(ida?.name).toBe("Ida");
  });

  it("pins the stored weekday convention (1=Mon … 7=Sun, so Sunday=7 not 0) when counting capacity days", async () => {
    // Hand-checked: 2026-01-05 is a Monday, so 2026-01-05..2026-01-11 is
    // exactly one full week (Mon..Sun): one Saturday (Jan 10, JS getUTCDay()=6,
    // matches stored `6` directly) and one Sunday (Jan 11, JS getUTCDay()=0,
    // stored convention is `7`). A member whose working_days is [6, 7]
    // (Sat+Sun only) must show exactly 2 capacity days over this window. If
    // the getUTCDay()->stored-convention remap for Sunday were dropped (or
    // inverted), Sunday would never match `7` and this would silently come
    // out as 1 day instead of 2.
    const client = fakeClient(
      [],
      [{ user_id: "u1", hours_per_day: 10, working_days: [6, 7] }],
    );

    const rows = await getWorkloadSummaryCore(client as never, {
      orgId: "o1",
      from: "2026-01-05",
      to: "2026-01-11",
      members: [{ userId: "u1", fullName: "Ada", avatarUrl: null }],
    });

    expect(rows[0]?.capacitySecs).toBe(10 * 3600 * 2);
  });

  it("falls back to the org default capacity, then EFFORT_FALLBACK, when a member has no capacity row", async () => {
    // 2026-01-05..2026-01-09 is Mon..Fri: 5 working days under the
    // EFFORT_FALLBACK default [1,2,3,4,5], with no org_workload_settings row.
    const client = fakeClient([], []);

    const rows = await getWorkloadSummaryCore(client as never, {
      orgId: "o1",
      from: "2026-01-05",
      to: "2026-01-09",
      members: [{ userId: "u2", fullName: "Grace", avatarUrl: null }],
    });

    expect(rows[0]?.capacitySecs).toBe(8 * 3600 * 5);
  });
});
