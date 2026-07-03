import { describe, it, expect, vi } from "vitest";
import {
  resolveAggregate,
  resolveCompletion,
  resolveHealth,
} from "./widget-resolve";

function fakeClient(rpc: Record<string, unknown>) {
  return {
    rpc: vi.fn(async (name: string) => ({
      data: (rpc as Record<string, unknown>)[name] ?? null,
      error: null,
    })),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        order: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("resolveAggregate", () => {
  it("sums buckets from dashboard_aggregate", async () => {
    const c = fakeClient({
      dashboard_aggregate: [{ group_key: null, metric: 7 }],
    });
    const r = await resolveAggregate(c, {
      boardId: "b",
      config: { agg: "count" },
    });
    expect(r).toEqual({
      ok: true,
      buckets: [{ group_key: null, metric: 7 }],
      columnMeta: null,
    });
  });
});

describe("resolveHealth", () => {
  it("camelCases the health summary row", async () => {
    const c = fakeClient({
      dashboard_health_summary: [
        {
          total_items: 8,
          done_items: 2,
          overdue_items: 3,
          incomplete_items: 4,
          new_items: 1,
        },
      ],
    });
    const r = await resolveHealth(c, { boardId: "b" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.counts.overdueItems).toBe(3);
  });
});

describe("resolveCompletion", () => {
  it("returns empty when unconfigured", async () => {
    const c = fakeClient({});
    const r = await resolveCompletion(c, { boardId: "b", config: {} });
    expect(r).toEqual({ ok: true, rows: [], groups: [] });
  });
});
