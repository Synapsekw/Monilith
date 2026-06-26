import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: (tag: string) => updateTag(tag),
}));

let currentClient: unknown;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

// queries-cached pulls in `server-only` + a `use cache` scope that can't run
// under Vitest; stub the one fn actions.ts consumes.
const getWidgetAggregationCached = vi.fn();
vi.mock("./queries-cached", () => ({
  getWidgetAggregationCached: (...args: unknown[]) =>
    getWidgetAggregationCached(...args),
}));

import {
  createDashboard,
  renameDashboard,
  deleteDashboard,
  duplicateDashboard,
  createWidget,
  updateWidgetConfig,
  deleteWidget,
  getWidgetData,
} from "./actions";

const WS = "11111111-1111-4111-8111-111111111111";
const DASH = "22222222-2222-4222-8222-222222222222";
const WIDGET = "33333333-3333-4333-8333-333333333333";
const BOARD = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  updateTag.mockReset();
  getWidgetAggregationCached.mockReset();
});

describe("dashboard mutation invalidation", () => {
  it("createDashboard updates the org dashboards tag", async () => {
    const rpc = vi.fn(async () => ({
      data: { id: DASH, org_id: "org-1" },
      error: null,
    }));
    currentClient = { rpc };
    const res = await createDashboard({ workspaceId: WS, name: "D" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-1");
  });

  it("renameDashboard updates the org dashboards tag", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: DASH, org_id: "org-2" },
      error: null,
    }));
    const from = vi.fn(() => ({
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle }) }),
      }),
    }));
    currentClient = { from };
    const res = await renameDashboard({ dashboardId: DASH, name: "New" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-2");
  });

  it("deleteDashboard updates the org dashboards tag", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { org_id: "org-3" },
      error: null,
    }));
    const del = vi.fn(() => ({
      eq: () => ({ select: () => ({ maybeSingle }) }),
    }));
    const from = vi.fn(() => ({ delete: del }));
    currentClient = { from };
    const res = await deleteDashboard({ dashboardId: DASH });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-3");
  });

  it("duplicateDashboard updates the org dashboards tag", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { org_id: "org-4" },
      error: null,
    }));
    const rpc = vi.fn(async () => ({ data: { id: "new-dash" }, error: null }));
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }));
    currentClient = { rpc, from };
    const res = await duplicateDashboard({ dashboardId: DASH });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith("dashboards:org:org-4");
  });
});

describe("widget mutation invalidation (per-widget aggregation tag)", () => {
  it("createWidget updates the widget aggregation tag", async () => {
    const rpc = vi.fn(async () => ({
      data: { id: WIDGET, org_id: "org-1", kind: "number" },
      error: null,
    }));
    currentClient = { rpc };
    const res = await createWidget({
      dashboardId: DASH,
      kind: "number",
      sourceBoardId: BOARD,
      title: "Count",
      config: { agg: "count" },
    });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(
      `widget-agg:org:org-1:widget:${WIDGET}`,
    );
  });

  it("updateWidgetConfig updates the widget aggregation tag", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: WIDGET, org_id: "org-2", dashboard_id: DASH },
      error: null,
    }));
    const from = vi.fn(() => ({
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle }) }),
      }),
    }));
    currentClient = { from };
    const res = await updateWidgetConfig({ widgetId: WIDGET, title: "New" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(
      `widget-agg:org:org-2:widget:${WIDGET}`,
    );
  });

  it("deleteWidget updates the widget aggregation tag", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { org_id: "org-3" },
      error: null,
    }));
    const del = vi.fn(() => ({
      eq: () => ({ select: () => ({ maybeSingle }) }),
    }));
    const from = vi.fn(() => ({ delete: del }));
    currentClient = { from };
    const res = await deleteWidget({ widgetId: WIDGET });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledWith(
      `widget-agg:org:org-3:widget:${WIDGET}`,
    );
  });
});

describe("getWidgetData delegates to the cached aggregation read", () => {
  it("passes the widget's resolved org + board into the cached fn", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        kind: "number",
        config: { agg: "count" },
        source_board_id: BOARD,
        org_id: "org-9",
      },
      error: null,
    }));
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }));
    currentClient = { from };
    getWidgetAggregationCached.mockResolvedValue({
      ok: true,
      buckets: [{ group_key: "g", metric: 5 }],
      columnMeta: null,
    });

    const res = await getWidgetData({ widgetId: WIDGET });
    expect(res.ok).toBe(true);
    expect(getWidgetAggregationCached).toHaveBeenCalledWith(
      expect.objectContaining({
        widgetId: WIDGET,
        orgId: "org-9",
        boardId: BOARD,
      }),
    );
    if (res.ok)
      expect(res.data.buckets).toEqual([{ group_key: "g", metric: 5 }]);
  });

  it("propagates a cached-read error", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        kind: "number",
        config: {},
        source_board_id: BOARD,
        org_id: "org-9",
      },
      error: null,
    }));
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }));
    currentClient = { from };
    getWidgetAggregationCached.mockResolvedValue({
      ok: false,
      error: "rpc boom",
    });

    const res = await getWidgetData({ widgetId: WIDGET });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("rpc boom");
  });
});
