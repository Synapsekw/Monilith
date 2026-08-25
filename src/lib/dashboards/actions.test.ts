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

// The aggregate family (number/battery/completion/health) now resolves over
// the request's own RLS client via widget-resolve.ts's resolveAggregate/
// resolveCompletion/resolveHealth (see widget-slot-core.ts) instead of the
// old queries-cached.ts service-client path. Stub just those three; keep
// resolveSeries/resolveRows real so the chart/list tests below still exercise
// the genuine implementation.
const resolveAggregate = vi.fn();
const resolveCompletion = vi.fn();
const resolveHealth = vi.fn();
vi.mock("./widget-resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./widget-resolve")>();
  return {
    ...actual,
    resolveAggregate: (...args: unknown[]) => resolveAggregate(...args),
    resolveCompletion: (...args: unknown[]) => resolveCompletion(...args),
    resolveHealth: (...args: unknown[]) => resolveHealth(...args),
  };
});

import {
  createDashboard,
  renameDashboard,
  deleteDashboard,
  duplicateDashboard,
  createWidget,
  updateWidgetConfig,
  deleteWidget,
  getWidgetData,
  getWidgetsData,
} from "./actions";

const WS = "11111111-1111-4111-8111-111111111111";
const DASH = "22222222-2222-4222-8222-222222222222";
const WIDGET = "33333333-3333-4333-8333-333333333333";
const BOARD = "44444444-4444-4444-8444-444444444444";
const WIDGET_2 = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  updateTag.mockReset();
  resolveAggregate.mockReset();
  resolveCompletion.mockReset();
  resolveHealth.mockReset();
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

describe("getWidgetData delegates to the RLS-client aggregate resolve", () => {
  it("passes the request's own client + the widget's resolved board into resolveAggregate", async () => {
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
    resolveAggregate.mockResolvedValue({
      ok: true,
      buckets: [{ group_key: "g", metric: 5 }],
      columnMeta: null,
    });

    const res = await getWidgetData({ widgetId: WIDGET });
    expect(res.ok).toBe(true);
    expect(resolveAggregate).toHaveBeenCalledWith(
      currentClient,
      expect.objectContaining({ boardId: BOARD, config: { agg: "count" } }),
    );
    if (res.ok)
      expect(res.data.buckets).toEqual([{ group_key: "g", metric: 5 }]);
  });

  it("propagates a resolve error", async () => {
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
    resolveAggregate.mockResolvedValue({
      ok: false,
      error: "rpc boom",
    });

    const res = await getWidgetData({ widgetId: WIDGET });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("rpc boom");
  });
});

describe("getWidgetsData (batched, one round-trip)", () => {
  it("rejects a non-uuid widget id via the Zod schema", async () => {
    // No client work should happen for invalid input.
    currentClient = {};
    const res = await getWidgetsData({ widgetIds: ["not-a-uuid"] });
    expect(res.ok).toBe(false);
    expect(resolveAggregate).not.toHaveBeenCalled();
  });

  it("short-circuits an empty id list with an empty map (no query)", async () => {
    const from = vi.fn();
    currentClient = { from };
    const res = await getWidgetsData({ widgetIds: [] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.results).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });

  it("reads all rows in ONE .in query and returns a map keyed by widget id", async () => {
    const inFn = vi.fn(async () => ({
      data: [
        {
          id: WIDGET,
          kind: "number",
          config: { agg: "count" },
          source_board_id: BOARD,
          org_id: "org-9",
        },
        {
          id: WIDGET_2,
          kind: "battery",
          config: { groupColumnId: "col-1" },
          source_board_id: BOARD,
          org_id: "org-9",
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    currentClient = { from };
    resolveAggregate.mockResolvedValue({
      ok: true,
      buckets: [{ group_key: "g", metric: 3 }],
      columnMeta: null,
    });

    const res = await getWidgetsData({ widgetIds: [WIDGET, WIDGET_2] });

    // Exactly one table read, via `.in("id", [...])`.
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("dashboard_widgets");
    expect(inFn).toHaveBeenCalledWith("id", [WIDGET, WIDGET_2]);
    // One aggregation per widget, computed concurrently (Promise.all).
    expect(resolveAggregate).toHaveBeenCalledTimes(2);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Object.keys(res.data.results).sort()).toEqual(
        [WIDGET, WIDGET_2].sort(),
      );
      const slot = res.data.results[WIDGET];
      expect(slot.ok).toBe(true);
      // `"buckets" in slot` narrows the union to the aggregate slot (chart/list
      // slots are `shape`-tagged and carry no buckets).
      if (slot.ok && "buckets" in slot)
        expect(slot.buckets).toEqual([{ group_key: "g", metric: 3 }]);
    }
  });

  it("isolates a per-widget failure — one bad aggregation doesn't blank the rest", async () => {
    const inFn = vi.fn(async () => ({
      data: [
        {
          id: WIDGET,
          kind: "number",
          config: { agg: "count" },
          source_board_id: BOARD,
          org_id: "org-9",
        },
        {
          id: WIDGET_2,
          kind: "number",
          config: { agg: "count" },
          source_board_id: BOARD,
          org_id: "org-9",
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    currentClient = { from };
    // Both widgets share the same board/config, so nothing in the call args
    // tells them apart — resolveWidgetAggregate invokes resolveAggregate
    // synchronously in `.map()` array order (WIDGET then WIDGET_2), so the
    // resolution order of the two calls is deterministic here too.
    resolveAggregate
      .mockResolvedValueOnce({
        ok: true,
        buckets: [{ group_key: null, metric: 7 }],
        columnMeta: null,
      })
      .mockResolvedValueOnce({ ok: false, error: "boom" });

    const res = await getWidgetsData({ widgetIds: [WIDGET, WIDGET_2] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const good = res.data.results[WIDGET];
      const bad = res.data.results[WIDGET_2];
      expect(good.ok).toBe(true);
      if (good.ok && "buckets" in good)
        expect(good.buckets).toEqual([{ group_key: null, metric: 7 }]);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toBe("boom");
    }
  });

  it("resolves a completion widget slot via the completion RLS-client read", async () => {
    const STATUS_COL = "66666666-6666-4666-8666-666666666666";
    const DONE_OPT = "77777777-7777-4777-8777-777777777777";
    const config = {
      mode: "status",
      statusColumnId: STATUS_COL,
      doneOptionIds: [DONE_OPT],
    };
    const inFn = vi.fn(async () => ({
      data: [
        {
          id: WIDGET,
          kind: "completion",
          config,
          source_board_id: BOARD,
          org_id: "org-9",
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    currentClient = { from };
    resolveCompletion.mockResolvedValue({
      ok: true,
      rows: [{ groupKey: "g1", itemCount: 2, completion: 50 }],
      groups: [{ id: "g1", label: "WS A", color: "#0073ea" }],
    });

    const res = await getWidgetsData({ widgetIds: [WIDGET] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(resolveCompletion).toHaveBeenCalledWith(
      currentClient,
      expect.objectContaining({ boardId: BOARD, config }),
    );
    expect(resolveAggregate).not.toHaveBeenCalled();
    const slot = res.data.results[WIDGET];
    expect(slot.ok).toBe(true);
    if (!slot.ok || !("buckets" in slot)) return;
    expect(slot.kind).toBe("completion");
    expect(slot.completion?.rows[0]).toMatchObject({
      groupKey: "g1",
      completion: 50,
    });
    expect(slot.completion?.groups[0]).toMatchObject({ label: "WS A" });
    expect(slot.buckets).toEqual([]);
    expect(slot.columnMeta).toBeNull();
  });

  it("a completion widget's failure does not blank sibling slots", async () => {
    const inFn = vi.fn(async () => ({
      data: [
        {
          id: WIDGET,
          kind: "completion",
          config: { mode: "status" },
          source_board_id: BOARD,
          org_id: "org-9",
        },
        {
          id: WIDGET_2,
          kind: "number",
          config: { agg: "count" },
          source_board_id: BOARD,
          org_id: "org-9",
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    currentClient = { from };
    resolveCompletion.mockResolvedValue({ ok: false, error: "boom" });
    resolveAggregate.mockResolvedValue({
      ok: true,
      buckets: [{ group_key: null, metric: 7 }],
      columnMeta: null,
    });

    const res = await getWidgetsData({ widgetIds: [WIDGET, WIDGET_2] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.results[WIDGET].ok).toBe(false);
    expect(res.data.results[WIDGET_2].ok).toBe(true);
  });

  it("resolves a health widget slot via the health RLS-client read", async () => {
    const inFn = vi.fn(async () => ({
      data: [
        {
          id: WIDGET,
          kind: "health",
          config: {},
          source_board_id: BOARD,
          org_id: "org-9",
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    currentClient = { from };
    resolveHealth.mockResolvedValue({
      ok: true,
      counts: {
        totalItems: 8,
        doneItems: 2,
        overdueItems: 3,
        incompleteItems: 4,
        newItems7d: 1,
      },
    });

    const res = await getWidgetsData({ widgetIds: [WIDGET] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(resolveHealth).toHaveBeenCalledWith(
      currentClient,
      expect.objectContaining({ boardId: BOARD }),
    );
    expect(resolveAggregate).not.toHaveBeenCalled();
    const slot = res.data.results[WIDGET];
    expect(slot.ok).toBe(true);
    if (!slot.ok || !("buckets" in slot)) return;
    expect(slot.kind).toBe("health");
    expect(slot.health).toMatchObject({ overdueItems: 3, newItems7d: 1 });
    expect(slot.buckets).toEqual([]);
  });

  it("a health widget's failure does not blank sibling slots", async () => {
    const inFn = vi.fn(async () => ({
      data: [
        {
          id: WIDGET,
          kind: "health",
          config: {},
          source_board_id: BOARD,
          org_id: "org-9",
        },
        {
          id: WIDGET_2,
          kind: "number",
          config: { agg: "count" },
          source_board_id: BOARD,
          org_id: "org-9",
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    currentClient = { from };
    resolveHealth.mockResolvedValue({ ok: false, error: "boom" });
    resolveAggregate.mockResolvedValue({
      ok: true,
      buckets: [{ group_key: null, metric: 7 }],
      columnMeta: null,
    });

    const res = await getWidgetsData({ widgetIds: [WIDGET, WIDGET_2] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.results[WIDGET].ok).toBe(false);
    expect(res.data.results[WIDGET_2].ok).toBe(true);
  });

  it("resolves a chart widget into a `series`-shaped slot (not an aggregate call)", async () => {
    // Chart + list widgets now ride the same batched fetch as the aggregate
    // family (fold of the old per-widget getWidgetSeries/getWidgetRows). A chart
    // with no source board short-circuits resolveSeries to empty points without
    // touching the aggregate resolve.
    const inFn = vi.fn(async () => ({
      data: [
        {
          id: WIDGET,
          kind: "chart",
          config: {},
          source_board_id: null,
          org_id: "org-9",
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    currentClient = { from };

    const res = await getWidgetsData({ widgetIds: [WIDGET] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const slot = res.data.results[WIDGET];
    expect(slot.ok).toBe(true);
    if (!slot.ok) return;
    expect("shape" in slot && slot.shape).toBe("series");
    if ("series" in slot) expect(slot.series.points).toEqual([]);
    expect(resolveAggregate).not.toHaveBeenCalled();
  });

  it("resolves a list widget into a `rows`-shaped slot via the list-rows RPC", async () => {
    const inFn = vi.fn(async () => ({
      data: [
        {
          id: WIDGET,
          kind: "list",
          // No columnIds ⇒ resolveRows only hits the bounded list-rows RPC.
          config: {},
          source_board_id: BOARD,
          org_id: "org-9",
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    const rpc = vi.fn(async () => ({
      data: [{ item_id: "i1", name: "Item 1", created_at: "2026-01-01" }],
      error: null,
    }));
    currentClient = { from, rpc };

    const res = await getWidgetsData({ widgetIds: [WIDGET] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const slot = res.data.results[WIDGET];
    expect(slot.ok).toBe(true);
    if (!slot.ok) return;
    expect("shape" in slot && slot.shape).toBe("rows");
    if ("rows" in slot) {
      expect(slot.rows.rows).toHaveLength(1);
      expect(slot.rows.rows[0]).toMatchObject({ itemId: "i1", name: "Item 1" });
      expect(slot.rows.columns).toEqual([]);
    }
    expect(rpc).toHaveBeenCalledWith(
      "dashboard_list_rows",
      expect.objectContaining({ p_board_id: BOARD }),
    );
    expect(resolveAggregate).not.toHaveBeenCalled();
  });

  it("returns empty buckets for a widget with no source board (no aggregation call)", async () => {
    const inFn = vi.fn(async () => ({
      data: [
        {
          id: WIDGET,
          kind: "number",
          config: {},
          source_board_id: null,
          org_id: "org-9",
        },
      ],
      error: null,
    }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    currentClient = { from };

    const res = await getWidgetsData({ widgetIds: [WIDGET] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const slot = res.data.results[WIDGET];
      expect(slot.ok).toBe(true);
      if (slot.ok && "buckets" in slot) expect(slot.buckets).toEqual([]);
    }
    expect(resolveAggregate).not.toHaveBeenCalled();
  });
});
