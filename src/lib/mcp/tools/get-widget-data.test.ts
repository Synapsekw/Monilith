import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWidgetDataHandler } from "./get-widget-data";

const slot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dashboards/widget-slot-core", () => ({
  resolveWidgetSlot: slot,
}));

type Row = Record<string, unknown> | null;

/** A minimal Supabase-shaped fake that asserts the table, the projected
 *  columns, and the `.eq` filter the handler is expected to use — not just
 *  returning canned data. Querying a table absent from `responses`, or
 *  filtering on the wrong column/id/projection, fails the test loudly rather
 *  than silently returning undefined. */
function fakeClient(
  responses: Record<
    string,
    { data: Row; expectColumns: string; expectId: string }
  >,
) {
  const from = vi.fn((table: string) => {
    const resp = responses[table];
    if (!resp) throw new Error(`Unexpected table read: ${table}`);
    return {
      select: vi.fn((columns: string) => {
        expect(columns).toBe(resp.expectColumns);
        return {
          eq: vi.fn((column: string, value: string) => {
            expect(column).toBe("id");
            expect(value).toBe(resp.expectId);
            return {
              maybeSingle: async () => ({ data: resp.data, error: null }),
            };
          }),
        };
      }),
    };
  });
  return { from };
}

const WIDGET_COLUMNS = "kind, config, source_board_id, org_id";

describe("getWidgetDataHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the widget slot and returns its payload", async () => {
    slot.mockResolvedValue({
      ok: true,
      shape: "series",
      series: [{ x: "Mon", y: 3 }],
    });
    const widget = {
      kind: "chart",
      config: {},
      source_board_id: "b1",
      org_id: "o1",
    };
    const client = fakeClient({
      dashboard_widgets: {
        data: widget,
        expectColumns: WIDGET_COLUMNS,
        expectId: "w1",
      },
      boards: { data: { id: "b1" }, expectColumns: "id", expectId: "b1" },
    });
    const getClient = vi.fn(async () => client as never);

    const result = await getWidgetDataHandler(getClient, { widgetId: "w1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(slot).toHaveBeenCalledWith(client, "w1", widget);
    expect(JSON.parse(result.content[0].text)).toEqual({
      shape: "series",
      series: [{ x: "Mon", y: 3 }],
    });
  });

  it("errors when the widget is not visible", async () => {
    const client = fakeClient({
      dashboard_widgets: {
        data: null,
        expectColumns: WIDGET_COLUMNS,
        expectId: "missing",
      },
    });
    const getClient = vi.fn(async () => client as never);

    const result = await getWidgetDataHandler(getClient, {
      widgetId: "missing",
    });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
    expect(slot).not.toHaveBeenCalled();
  });

  it("errors when the widget is visible but its source board is not, without leaking which", async () => {
    const widget = {
      kind: "number",
      config: {},
      source_board_id: "b1",
      org_id: "o1",
    };
    const client = fakeClient({
      dashboard_widgets: {
        data: widget,
        expectColumns: WIDGET_COLUMNS,
        expectId: "w1",
      },
      boards: { data: null, expectColumns: "id", expectId: "b1" },
    });
    const getClient = vi.fn(async () => client as never);

    const result = await getWidgetDataHandler(getClient, { widgetId: "w1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    // Same shape as a genuinely missing widget — never distinguishes
    // "board exists but you can't read it" from "not found".
    expect(result.content[0].text).toBe("Widget w1 not found.");
    expect(slot).not.toHaveBeenCalled();
  });

  it("skips the board precheck for a widget with no source board", async () => {
    slot.mockResolvedValue({
      ok: true,
      kind: "number",
      config: {},
      buckets: [],
      columnMeta: null,
    });
    const widget = {
      kind: "number",
      config: {},
      source_board_id: null,
      org_id: "o1",
    };
    const client = fakeClient({
      dashboard_widgets: {
        data: widget,
        expectColumns: WIDGET_COLUMNS,
        expectId: "w1",
      },
    });
    const getClient = vi.fn(async () => client as never);

    const result = await getWidgetDataHandler(getClient, { widgetId: "w1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(slot).toHaveBeenCalledWith(client, "w1", widget);
  });

  it("surfaces a slot resolution failure", async () => {
    slot.mockResolvedValue({ ok: false, error: "bad config" });
    const widget = {
      kind: "chart",
      config: {},
      source_board_id: "b1",
      org_id: "o1",
    };
    const client = fakeClient({
      dashboard_widgets: {
        data: widget,
        expectColumns: WIDGET_COLUMNS,
        expectId: "w1",
      },
      boards: { data: { id: "b1" }, expectColumns: "id", expectId: "b1" },
    });
    const getClient = vi.fn(async () => client as never);

    const result = await getWidgetDataHandler(getClient, { widgetId: "w1" });

    expect(getClient).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("bad config");
  });
});
