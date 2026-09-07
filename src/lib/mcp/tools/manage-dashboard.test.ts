import { describe, expect, it } from "vitest";
import { manageDashboardDescriptor } from "./manage-dashboard";

const ORG = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const DASH = "33333333-3333-4333-8333-333333333333";
const WIDGET = "44444444-4444-4444-8444-444444444444";

type Row = { data: unknown; error: unknown };

/** `organizations` → listToolOrgs; `workspaces` → the create path's default
 *  workspace pick; `dashboards` → the rename/delete statements. */
function client(opts: {
  orgs?: { id: string; name: string }[];
  workspace?: Row;
  dashboards?: Row;
  rpc?: (fn: string, args: Record<string, unknown>) => Row;
}) {
  const calls: string[] = [];
  const supabase = {
    from: (table: string) => {
      calls.push(table);
      if (table === "organizations")
        return {
          select: () => ({
            order: async () => ({ data: opts.orgs ?? [], error: null }),
          }),
        };
      if (table === "workspaces")
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () =>
                    opts.workspace ?? { data: null, error: null },
                }),
              }),
            }),
          }),
        };
      // dashboards: update…select…maybeSingle AND delete…select…maybeSingle
      const terminal = {
        maybeSingle: async () => opts.dashboards ?? { data: null, error: null },
      };
      return {
        update: () => ({ eq: () => ({ select: () => terminal }) }),
        delete: () => ({ eq: () => ({ select: () => terminal }) }),
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) =>
      opts.rpc ? opts.rpc(fn, args) : { data: null, error: null },
  };
  return { supabase, calls };
}

const ctx = (supabase: unknown) => ({
  actorId: "u1",
  getClient: async () => supabase as never,
});

describe("manage_dashboard create", () => {
  it("creates in the org's first workspace when none is named", async () => {
    let rpcArgs: Record<string, unknown> | undefined;
    const { supabase } = client({
      orgs: [{ id: ORG, name: "Acme" }],
      workspace: { data: { id: WS }, error: null },
      rpc: (_fn, args) => {
        rpcArgs = args;
        return {
          data: { id: DASH, name: "Ops", org_id: ORG, workspace_id: WS },
          error: null,
        };
      },
    });

    const r = await manageDashboardDescriptor.invoke(ctx(supabase), {
      action: "create",
      name: "Ops",
    });

    expect(r.isError).toBeUndefined();
    expect(rpcArgs).toEqual({ p_workspace_id: WS, p_name: "Ops" });
    expect(JSON.parse(r.content[0].text)).toMatchObject({
      dashboardId: DASH,
      orgId: ORG,
    });
  });

  // resolveToolOrg refuses an org the caller is not in rather than falling
  // back to another one — the whole point of not reusing pickActiveOrg.
  it("refuses an orgId the caller is not a member of", async () => {
    const { supabase } = client({ orgs: [{ id: ORG, name: "Acme" }] });
    const r = await manageDashboardDescriptor.invoke(ctx(supabase), {
      action: "create",
      name: "Ops",
      orgId: WS,
    });
    expect(r.isError).toBe(true);
  });

  // A dashboard row cannot exist without a workspace (create_dashboard derives
  // the org FROM the workspace), so say so instead of failing in Postgres.
  it("reports an org with no workspace instead of calling the RPC", async () => {
    let called = false;
    const { supabase } = client({
      orgs: [{ id: ORG, name: "Acme" }],
      workspace: { data: null, error: null },
      rpc: () => {
        called = true;
        return { data: null, error: null };
      },
    });
    const r = await manageDashboardDescriptor.invoke(ctx(supabase), {
      action: "create",
      name: "Ops",
    });
    expect(r.isError).toBe(true);
    expect(called).toBe(false);
  });
});

describe("manage_dashboard rename / delete / save_layout", () => {
  it("renames and returns the updated row", async () => {
    const { supabase } = client({
      dashboards: {
        data: { id: DASH, name: "Renamed", org_id: ORG },
        error: null,
      },
    });
    const r = await manageDashboardDescriptor.invoke(ctx(supabase), {
      action: "rename",
      dashboardId: DASH,
      name: "Renamed",
    });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual({
      dashboardId: DASH,
      name: "Renamed",
    });
  });

  // A delete that matched nothing must not report success: RLS-invisible and
  // already-deleted both land here, and "deleted: true" would be a lie the
  // model repeats to its owner.
  it("reports a delete that matched no row as an error", async () => {
    const { supabase } = client({ dashboards: { data: null, error: null } });
    const r = await manageDashboardDescriptor.invoke(ctx(supabase), {
      action: "delete",
      dashboardId: DASH,
    });
    expect(r.isError).toBe(true);
  });

  it("deletes a visible dashboard", async () => {
    const { supabase } = client({
      dashboards: { data: { org_id: ORG }, error: null },
    });
    const r = await manageDashboardDescriptor.invoke(ctx(supabase), {
      action: "delete",
      dashboardId: DASH,
    });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual({
      dashboardId: DASH,
      deleted: true,
    });
  });

  it("passes the layout rectangles through to set_widget_layouts", async () => {
    let rpcArgs: Record<string, unknown> | undefined;
    const { supabase } = client({
      rpc: (_fn, args) => {
        rpcArgs = args;
        return { data: null, error: null };
      },
    });
    const r = await manageDashboardDescriptor.invoke(ctx(supabase), {
      action: "save_layout",
      dashboardId: DASH,
      layout: [{ id: WIDGET, x: 0, y: 0, w: 3, h: 2 }],
    });
    expect(r.isError).toBeUndefined();
    expect(rpcArgs).toEqual({
      p_dashboard_id: DASH,
      p_layouts: [{ id: WIDGET, x: 0, y: 0, w: 3, h: 2 }],
    });
    expect(JSON.parse(r.content[0].text)).toEqual({ saved: 1 });
  });

  it("rejects an unknown action without opening a client", async () => {
    let opened = false;
    const r = await manageDashboardDescriptor.invoke(
      {
        actorId: "u1",
        getClient: async () => {
          opened = true;
          return {} as never;
        },
      },
      { action: "obliterate", dashboardId: DASH },
    );
    expect(r.isError).toBe(true);
    expect(opened).toBe(false);
  });
});

describe("manage_dashboard classification", () => {
  const actions = [
    "create",
    "rename",
    "duplicate",
    "delete",
    "save_layout",
  ] as const;

  it("charges board.destroy for delete and board.structure for the rest", () => {
    expect(manageDashboardDescriptor.capability).toEqual({
      create: "board.structure",
      rename: "board.structure",
      duplicate: "board.structure",
      delete: "board.destroy",
      save_layout: "board.structure",
    });
  });

  // A dashboard's widgets can read from many boards, so no single board id is
  // "the" board this call addresses.
  it("declares scope none for every action", () => {
    for (const action of actions) {
      expect(
        (manageDashboardDescriptor.scope as Record<string, string>)[action],
        action,
      ).toBe("none");
    }
  });

  it("declares create as an unscoped create", () => {
    expect(manageDashboardDescriptor.unscopedCreateActions).toEqual(["create"]);
  });

  it("lists every action in the input enum", () => {
    const enumValues = (
      manageDashboardDescriptor.inputSchema.action as unknown as {
        options: string[];
      }
    ).options;
    expect([...enumValues].sort()).toEqual([...actions].sort());
  });
});
