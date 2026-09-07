import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";
import { manageDashboardHandler } from "./manage-dashboard";
import { manageWidgetHandler } from "./manage-widget";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type Tenant = {
  id: string;
  orgId: string;
  boardId: string;
  dashboardId: string;
  dashboardName: string;
};

describe.skipIf(!integrationTargetReady())(
  "MCP manage_dashboard / manage_widget: RLS still applies (a dashboard is never writable across orgs)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let tenantA: Tenant;
    let tenantB: Tenant;

    // Dynamic import DEFERRED until after loadIntegrationEnv() has overridden
    // process.env, because @/lib/env.ts caches NEXT_PUBLIC_SUPABASE_URL eagerly
    // at module-evaluation time and a static import would resolve during this
    // file's import-hoisting phase — baking in vitest.setup.ts's placeholder
    // localhost URL instead of the real target. Same fix as
    // list-items.rls.integration.test.ts.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    async function provision(label: string): Promise<Tenant> {
      const email = `mcp-dash-${label}-${randomUUID()}@example.com`;
      const { data: created } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      const id = created.user!.id;
      createdUserIds.push(id);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });

      const { data: org, error: orgErr } = await anon.rpc(
        "create_organization",
        {
          p_name: `Org ${label}`,
          p_slug: `mcp-dash-${label}-${randomUUID().slice(0, 8)}`,
        },
      );
      if (orgErr || !org)
        throw new Error(`create_organization failed: ${orgErr?.message}`);
      const orgId = (org as { id: string }).id;

      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
        .select("id")
        .single();

      const { data: board } = await anon.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: `Board ${label}`,
      });

      const dashboardName = `Dashboard ${label} ${randomUUID().slice(0, 8)}`;
      const { data: dashboard, error: dashErr } = await anon.rpc(
        "create_dashboard",
        { p_workspace_id: (ws as { id: string }).id, p_name: dashboardName },
      );
      if (dashErr || !dashboard)
        throw new Error(`create_dashboard failed: ${dashErr?.message}`);

      return {
        id,
        orgId,
        boardId: (board as { id: string }).id,
        dashboardId: (dashboard as { id: string }).id,
        dashboardName,
      };
    }

    beforeAll(async () => {
      ({ mintBridgeSecret, getBridgedClient } =
        await import("@/lib/mcp/oauth/session-bridge"));
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      tenantA = await provision("a");
      tenantB = await provision("b");
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    // Anti-vacuity: "refused" is only evidence if the OWNER can do it.
    it("lets the owner rename and add a widget to their own dashboard", async () => {
      const secretId = await mintBridgeSecret(tenantA.id);
      const { client } = await getBridgedClient(secretId);

      const renamed = await manageDashboardHandler(async () => client, {
        action: "rename",
        dashboardId: tenantA.dashboardId,
        name: `${tenantA.dashboardName} v2`,
      });
      expect(renamed.isError).toBeUndefined();

      const { client: client2 } = await getBridgedClient(
        await mintBridgeSecret(tenantA.id),
      );
      const widget = await manageWidgetHandler(async () => client2, {
        action: "create",
        dashboardId: tenantA.dashboardId,
        kind: "number",
        sourceBoardId: tenantA.boardId,
        title: "Open items",
        config: { agg: "count" },
      });
      expect(widget.isError).toBeUndefined();
    }, 30_000);

    it("refuses another org's user renaming the dashboard", async () => {
      const secretId = await mintBridgeSecret(tenantB.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageDashboardHandler(async () => client, {
        action: "rename",
        dashboardId: tenantA.dashboardId,
        name: "Owned by B now",
      });

      // RLS makes org A's dashboard invisible, so the UPDATE matches no row.
      expect(result.isError).toBe(true);

      const { data: row } = await admin
        .from("dashboards")
        .select("name")
        .eq("id", tenantA.dashboardId)
        .single();
      expect(row!.name).not.toBe("Owned by B now");
    }, 30_000);

    it("refuses another org's user deleting the dashboard", async () => {
      const secretId = await mintBridgeSecret(tenantB.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageDashboardHandler(async () => client, {
        action: "delete",
        dashboardId: tenantA.dashboardId,
      });

      // A delete that matched nothing must be reported as a failure, never as
      // a success the model relays to its owner.
      expect(result.isError).toBe(true);

      const { data: row } = await admin
        .from("dashboards")
        .select("id")
        .eq("id", tenantA.dashboardId)
        .maybeSingle();
      expect(row).not.toBeNull();
    }, 30_000);

    it("refuses another org's user adding a widget to the dashboard", async () => {
      const secretId = await mintBridgeSecret(tenantB.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageWidgetHandler(async () => client, {
        action: "create",
        dashboardId: tenantA.dashboardId,
        kind: "number",
        sourceBoardId: tenantB.boardId,
        title: "Snooping",
        config: { agg: "count" },
      });

      // `create_dashboard_widget` is SECURITY DEFINER, so it sees the row and
      // then refuses on `is_org_member` — the widget must not exist either way.
      expect(result.isError).toBe(true);

      const { data: widgets } = await admin
        .from("dashboard_widgets")
        .select("id, title")
        .eq("dashboard_id", tenantA.dashboardId);
      expect((widgets ?? []).map((w) => w.title)).not.toContain("Snooping");
    }, 30_000);
  },
);
