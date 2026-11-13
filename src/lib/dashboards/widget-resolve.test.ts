import { describe, it, expect, vi } from "vitest";
import {
  resolveAggregate,
  resolveCompletion,
  resolveHealth,
  resolveSeries,
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

describe("resolveSeries people dimension", () => {
  it("lists people only: a Mono (role agent) is excluded from members", async () => {
    const neq = vi.fn(async () => ({ data: [], error: null }));
    const eq = vi.fn(() => ({ neq }));
    const select = vi.fn(() => ({ eq }));
    const c = {
      rpc: vi.fn(async () => ({
        data: [{ primary_key: "u1", series_key: null, value: 3 }],
        error: null,
      })),
      from: vi.fn(() => ({ select })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await resolveSeries(c, {
      boardId: "b",
      orgId: "org-1",
      config: {
        chartType: "bar",
        primary: { kind: "people", columnId: "col" },
      },
    });
    expect(c.from).toHaveBeenCalledWith("org_members");
    expect(eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(neq).toHaveBeenCalledWith("role", "agent");
  });
});
