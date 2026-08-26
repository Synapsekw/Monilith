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

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({ select: listSelect }),
  }),
}));

import { DASHBOARDS_LIMIT, listDashboardsCached } from "./queries-cached";

beforeEach(() => {
  listSelect.mockClear();
  listEq.mockClear();
  orderForList.mockClear();
  orderForList.mockReturnValue({ limit: limitForList });
  limitForList.mockReset();
});

// getWidgetAggregationCached / getWidgetCompletionCached / getWidgetHealthCached
// were removed from this module (see the NOTE in queries-cached.ts): they ran
// dashboard_aggregate/dashboard_completion/dashboard_health_summary on the
// service client, and those RPCs are SECURITY DEFINER + auth.uid()-gated, so
// the service client (no session) always got 42501. resolveWidgetAggregate
// (widget-slot-core.ts) now calls resolveAggregate/resolveCompletion/
// resolveHealth (widget-resolve.ts) over the request's own RLS client
// instead — covered by widget-resolve.test.ts and the RLS integration test
// (widget-aggregate-rls-client.rls.integration.test.ts).

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
