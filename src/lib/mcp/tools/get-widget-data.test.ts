import { describe, expect, it, vi } from "vitest";
import { getWidgetDataHandler } from "./get-widget-data";

const slot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dashboards/widget-slot-core", () => ({
  resolveWidgetSlot: slot,
}));

function fakeClient(widget: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: widget, error: null }),
        }),
      }),
    }),
  };
}

describe("getWidgetDataHandler", () => {
  it("resolves the widget slot and returns its payload", async () => {
    slot.mockResolvedValue({
      ok: true,
      shape: "series",
      series: [{ x: "Mon", y: 3 }],
    });
    const client = fakeClient({
      kind: "chart",
      config: {},
      source_board_id: "b1",
      org_id: "o1",
    });
    const getClient = vi.fn(async () => client as never);

    const result = await getWidgetDataHandler(getClient, { widgetId: "w1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual({
      shape: "series",
      series: [{ x: "Mon", y: 3 }],
    });
  });

  it("errors when the widget is not visible", async () => {
    const getClient = vi.fn(async () => fakeClient(null) as never);
    const result = await getWidgetDataHandler(getClient, {
      widgetId: "missing",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("surfaces a slot resolution failure", async () => {
    slot.mockResolvedValue({ ok: false, error: "bad config" });
    const client = fakeClient({
      kind: "chart",
      config: {},
      source_board_id: "b1",
      org_id: "o1",
    });
    const result = await getWidgetDataHandler(async () => client as never, {
      widgetId: "w1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("bad config");
  });
});
