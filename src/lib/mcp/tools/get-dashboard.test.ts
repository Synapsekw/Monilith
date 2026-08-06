import { describe, expect, it, vi } from "vitest";
import { getDashboardHandler } from "./get-dashboard";

const core = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dashboards/queries", () => ({ getDashboardPayloadCore: core }));

describe("getDashboardHandler", () => {
  it("returns widget descriptors without layout or palette", async () => {
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
      ],
    });

    const getClient = vi.fn(async () => ({}) as never);
    const result = await getDashboardHandler(getClient, { dashboardId: "d1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("Delivery");
    expect(parsed.widgets[0]).toEqual({
      widgetId: "w1",
      title: "Throughput",
      kind: "chart",
      boardId: "b1",
    });
  });

  it("errors when the dashboard is not visible", async () => {
    core.mockResolvedValue(null);
    const result = await getDashboardHandler(async () => ({}) as never, {
      dashboardId: "missing",
    });
    expect(result.isError).toBe(true);
  });
});
