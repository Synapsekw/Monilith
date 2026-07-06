import { beforeEach, describe, expect, it, vi } from "vitest";

// cacheTag/cacheLife throw outside a compiled `use cache` scope under Vitest.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

// `listDashboardsCached` path: from("dashboards").select().eq().eq?().order().limit()
const limitForList = vi.fn();
const orderForList = vi.fn(() => ({ limit: limitForList }));
// Builder returned by each .eq(): supports chaining another .eq() or terminating with .order().
const listBuilder: {
  eq: ReturnType<typeof vi.fn>;
  order: typeof orderForList;
} = {
  eq: vi.fn(() => listBuilder),
  order: orderForList,
};
const listEq = listBuilder.eq;
const listSelect = vi.fn(() => ({ eq: listEq }));

// `getWidgetAggregationCached` path: rpc("dashboard_aggregate", …) and
// from("columns").select().eq().maybeSingle()
const rpc = vi.fn();
const colMaybeSingle = vi.fn();
const colEq = vi.fn(() => ({ maybeSingle: colMaybeSingle }));
const colSelect = vi.fn(() => ({ eq: colEq }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === "columns" ? { select: colSelect } : { select: listSelect },
    rpc,
  }),
}));

import {
  DASHBOARDS_LIMIT,
  getWidgetAggregationCached,
  listDashboardsCached,
} from "./queries-cached";

beforeEach(() => {
  listSelect.mockClear();
  listEq.mockClear();
  orderForList.mockClear();
  orderForList.mockReturnValue({ limit: limitForList });
  limitForList.mockReset();
  rpc.mockReset();
  colSelect.mockClear();
  colEq.mockClear();
  colMaybeSingle.mockReset();
});

describe("listDashboardsCached", () => {
  it("filters by orgId (tenant boundary)", async () => {
    limitForList.mockResolvedValue({
      data: [{ id: "d1", name: "D" }],
      error: null,
    });
    const result = await listDashboardsCached("org-A");
    expect(listEq).toHaveBeenCalledWith("org_id", "org-A");
    expect(result).toEqual([{ id: "d1", name: "D" }]);
  });

  it("is bounded", async () => {
    limitForList.mockResolvedValue({ data: [], error: null });
    await listDashboardsCached("org-A");
    expect(limitForList).toHaveBeenCalledWith(DASHBOARDS_LIMIT);
  });

  it("returns [] when none", async () => {
    limitForList.mockResolvedValue({ data: null, error: null });
    expect(await listDashboardsCached("org-A")).toEqual([]);
  });

  it("scopes to workspace_id when a workspaceId is given", async () => {
    limitForList.mockResolvedValue({ data: [], error: null });
    await listDashboardsCached("org-A", "ws-1");
    expect(listEq).toHaveBeenCalledWith("org_id", "org-A");
    expect(listEq).toHaveBeenCalledWith("workspace_id", "ws-1");
  });

  it("does not scope by workspace when no workspaceId is given", async () => {
    limitForList.mockResolvedValue({ data: [], error: null });
    await listDashboardsCached("org-A");
    expect(listEq).toHaveBeenCalledWith("org_id", "org-A");
    expect(listEq).not.toHaveBeenCalledWith("workspace_id", expect.anything());
  });
});

describe("getWidgetAggregationCached", () => {
  it("runs dashboard_aggregate for the widget's board and maps buckets", async () => {
    rpc.mockResolvedValue({
      data: [{ group_key: "opt1", metric: "3" }],
      error: null,
    });
    const res = await getWidgetAggregationCached({
      widgetId: "w1",
      orgId: "org-A",
      boardId: "board-1",
      config: { agg: "count" },
      groupColumnId: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "dashboard_aggregate",
      expect.objectContaining({ p_board_id: "board-1", p_agg: "count" }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.buckets).toEqual([{ group_key: "opt1", metric: 3 }]);
      expect(res.columnMeta).toBeNull();
    }
  });

  it("resolves group-column options when grouped", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    colMaybeSingle.mockResolvedValue({
      data: {
        kind: "status",
        settings: { options: [{ id: "o1", label: "Open", color: "#fff" }] },
      },
      error: null,
    });
    const res = await getWidgetAggregationCached({
      widgetId: "w1",
      orgId: "org-A",
      boardId: "board-1",
      config: { agg: "count", groupColumnId: "col-1" },
      groupColumnId: "col-1",
    });
    expect(colSelect).toHaveBeenCalled();
    expect(colEq).toHaveBeenCalledWith("id", "col-1");
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.columnMeta).toEqual({
        kind: "status",
        options: [{ id: "o1", label: "Open", color: "#fff" }],
      });
  });

  it("returns an error string when the RPC fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await getWidgetAggregationCached({
      widgetId: "w1",
      orgId: "org-A",
      boardId: "board-1",
      config: { agg: "count" },
      groupColumnId: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("boom");
  });
});
