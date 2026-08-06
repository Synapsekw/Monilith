import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDashboardHandler } from "./get-dashboard";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dashboards/queries", () => ({ getDashboardPayloadCore: core }));

const slot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dashboards/widget-slot-core", () => ({
  resolveWidgetSlot: slot,
}));

describe("getDashboardHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns widget descriptors without layout, palette, or resolving data", async () => {
    core.mockResolvedValue({
      dashboard: { id: "d1", name: "Delivery" },
      widgets: [
        {
          id: "w1",
          kind: "chart",
          title: "Throughput",
          source_board_id: "b1",
          position: 0,
          config: { x: 1, y: 2, w: 4, h: 3, metric: "count" },
        },
        {
          id: "w2",
          kind: "number",
          title: "Overdue",
          source_board_id: "b2",
          position: 1,
          config: { x: 5, y: 0, w: 2, h: 2, agg: "count" },
        },
      ],
    });

    const getClient = vi.fn(async () => ({}) as never);
    const result = await getDashboardHandler(getClient, { dashboardId: "d1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Delivery");
    expect(parsed.widgets).toEqual([
      { widgetId: "w1", title: "Throughput", kind: "chart", boardId: "b1" },
      { widgetId: "w2", title: "Overdue", kind: "number", boardId: "b2" },
    ]);
    // Descriptors only — listing a dashboard must never resolve widget data
    // (that's the whole rationale for get_widget_data being a separate call).
    expect(slot).not.toHaveBeenCalled();
  });

  it("errors when the dashboard is not visible", async () => {
    core.mockResolvedValue(null);
    const getClient = vi.fn(async () => ({}) as never);

    const result = await getDashboardHandler(getClient, {
      dashboardId: "missing",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(slot).not.toHaveBeenCalled();
  });
});
