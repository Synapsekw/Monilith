import { describe, expect, it } from "vitest";
import { manageWidgetDescriptor } from "./manage-widget";

const DASH = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";
const WIDGET = "33333333-3333-4333-8333-333333333333";
const ORG = "44444444-4444-4444-8444-444444444444";
const COLUMN = "55555555-5555-4555-8555-555555555555";

type Row = { data: unknown; error: unknown };

/** `dashboard_widgets` serves three shapes: the kind pre-read
 *  (select→eq→maybeSingle), the update (update→eq→select→maybeSingle) and the
 *  delete (delete→eq→select→maybeSingle). */
function client(opts: {
  kindRow?: Row;
  updated?: Row;
  deleted?: Row;
  rpc?: (fn: string, args: Record<string, unknown>) => Row;
}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => opts.kindRow ?? { data: null, error: null },
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () =>
              opts.updated ?? { data: null, error: null },
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () =>
              opts.deleted ?? { data: null, error: null },
          }),
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) =>
      opts.rpc ? opts.rpc(fn, args) : { data: null, error: null },
  };
}

const ctx = (supabase: unknown) => ({
  actorId: "u1",
  getClient: async () => supabase as never,
});

const widgetRow = {
  id: WIDGET,
  dashboard_id: DASH,
  kind: "number",
  title: "Open items",
  source_board_id: BOARD,
  org_id: ORG,
};

describe("manage_widget create", () => {
  it("creates a widget with a valid kind-specific config", async () => {
    let rpcArgs: Record<string, unknown> | undefined;
    const supabase = client({
      rpc: (_fn, args) => {
        rpcArgs = args;
        return { data: widgetRow, error: null };
      },
    });

    const r = await manageWidgetDescriptor.invoke(ctx(supabase), {
      action: "create",
      dashboardId: DASH,
      kind: "number",
      sourceBoardId: BOARD,
      title: "Open items",
      config: { agg: "count" },
    });

    expect(r.isError).toBeUndefined();
    expect(rpcArgs?.p_dashboard_id).toBe(DASH);
    expect(JSON.parse(r.content[0].text)).toMatchObject({
      widgetId: WIDGET,
      dashboardId: DASH,
      kind: "number",
    });
  });

  // THE guard this whole tool hangs on: `configSchemaForKind` runs before any
  // statement. A config that does not match its kind is what makes the
  // dashboard page throw at render time, for a human, later — so it is
  // refused here rather than persisted.
  it("refuses a config that does not match the kind, without calling the RPC", async () => {
    let called = false;
    const supabase = client({
      rpc: () => {
        called = true;
        return { data: widgetRow, error: null };
      },
    });

    const r = await manageWidgetDescriptor.invoke(ctx(supabase), {
      action: "create",
      dashboardId: DASH,
      kind: "number",
      sourceBoardId: BOARD,
      title: "Sum",
      // `sum` needs a valueColumnId — the refine in numberConfigSchema.
      config: { agg: "sum" },
    });

    expect(r.isError).toBe(true);
    expect(called).toBe(false);
  });

  it("refuses a chart config saved against a battery widget", async () => {
    const supabase = client({});
    const r = await manageWidgetDescriptor.invoke(ctx(supabase), {
      action: "create",
      dashboardId: DASH,
      kind: "battery",
      sourceBoardId: BOARD,
      title: "Battery",
      config: { chartType: "bar", primary: { kind: "status" } },
    });
    expect(r.isError).toBe(true);
  });
});

describe("manage_widget update_config / delete", () => {
  // The config is validated against the widget's OWN kind, read from the row —
  // never against a kind the caller asserts.
  it("validates the config against the stored kind", async () => {
    const supabase = client({
      kindRow: { data: { kind: "battery" }, error: null },
      updated: { data: { ...widgetRow, kind: "battery" }, error: null },
    });

    const ok = await manageWidgetDescriptor.invoke(ctx(supabase), {
      action: "update_config",
      widgetId: WIDGET,
      config: { groupColumnId: COLUMN },
    });
    expect(ok.isError).toBeUndefined();

    const bad = await manageWidgetDescriptor.invoke(ctx(supabase), {
      action: "update_config",
      widgetId: WIDGET,
      config: { agg: "count" },
    });
    expect(bad.isError).toBe(true);
  });

  it("updates the title alone without touching the config", async () => {
    let sawKindRead = false;
    const supabase = {
      ...client({ updated: { data: widgetRow, error: null } }),
      from: () => ({
        select: () => {
          sawKindRead = true;
          return {
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          };
        },
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: widgetRow, error: null }),
            }),
          }),
        }),
      }),
    };

    const r = await manageWidgetDescriptor.invoke(ctx(supabase), {
      action: "update_config",
      widgetId: WIDGET,
      title: "Renamed",
    });
    expect(r.isError).toBeUndefined();
    expect(sawKindRead).toBe(false);
  });

  it("reports a delete that matched no row as an error", async () => {
    const supabase = client({ deleted: { data: null, error: null } });
    const r = await manageWidgetDescriptor.invoke(ctx(supabase), {
      action: "delete",
      widgetId: WIDGET,
    });
    expect(r.isError).toBe(true);
  });

  it("deletes a visible widget", async () => {
    const supabase = client({
      deleted: { data: { org_id: ORG }, error: null },
    });
    const r = await manageWidgetDescriptor.invoke(ctx(supabase), {
      action: "delete",
      widgetId: WIDGET,
    });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual({
      widgetId: WIDGET,
      deleted: true,
    });
  });
});

describe("manage_widget classification", () => {
  const actions = ["create", "update_config", "delete"] as const;

  it("charges board.destroy for delete and board.structure for the rest", () => {
    expect(manageWidgetDescriptor.capability).toEqual({
      create: "board.structure",
      update_config: "board.structure",
      delete: "board.destroy",
    });
  });

  it("declares scope none for every action", () => {
    for (const action of actions) {
      expect(
        (manageWidgetDescriptor.scope as Record<string, string>)[action],
        action,
      ).toBe("none");
    }
  });

  // THE difference from the other four planning tools: a widget is not a new
  // top-level object. It hangs off a dashboard the caller must already name,
  // so a board-narrowed agent creating one reaches outside nothing.
  it("declares NO unscoped create actions", () => {
    expect(manageWidgetDescriptor.unscopedCreateActions).toBeUndefined();
  });

  it("lists every action in the input enum", () => {
    const enumValues = (
      manageWidgetDescriptor.inputSchema.action as unknown as {
        options: string[];
      }
    ).options;
    expect([...enumValues].sort()).toEqual([...actions].sort());
  });
});
