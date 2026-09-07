import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";
import { manageViewHandler } from "./manage-view";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type Tenant = { id: string; boardId: string; viewId: string };

describe.skipIf(!integrationTargetReady())(
  "MCP manage_view: RLS still applies (a second org's user cannot create or delete a view on the first org's board)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let tenantA: Tenant;
    let tenantB: Tenant;

    // Dynamic import DEFERRED until after loadIntegrationEnv() has overridden
    // process.env — same fix as list-items.rls.integration.test.ts /
    // cross-org-access.rls.integration.test.ts.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    async function provision(label: string): Promise<Tenant> {
      const email = `mcp-manage-view-${label}-${randomUUID()}@example.com`;
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
          p_slug: `mcp-manage-view-${label}-${randomUUID().slice(0, 8)}`,
        },
      );
      if (orgErr || !org)
        throw new Error(`create_organization failed: ${orgErr?.message}`);

      const { data: ws } = await anon
        .from("workspaces")
        .insert({
          org_id: (org as { id: string }).id,
          name: `WS ${label}`,
          created_by: id,
        })
        .select("id")
        .single();

      const { data: board } = await anon.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: `Board ${label}`,
      });
      const boardId = (board as { id: string }).id;

      const { data: view } = await anon.rpc("create_board_view", {
        p_board_id: boardId,
        p_kind: "table",
        p_name: `View ${label}`,
        p_config: {},
      });

      return { id, boardId, viewId: (view as { id: string }).id };
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

    it("lets the owner create a view on their own board", async () => {
      const secretId = await mintBridgeSecret(tenantA.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageViewHandler(async () => client, {
        action: "create",
        boardId: tenantA.boardId,
        kind: "kanban",
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]!.text as string).viewId).toEqual(
        expect.any(String),
      );
    }, 30_000);

    it("refuses to create a view on another org's board", async () => {
      const secretId = await mintBridgeSecret(tenantA.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageViewHandler(async () => client, {
        action: "create",
        boardId: tenantB.boardId,
        kind: "kanban",
      });

      // RLS makes org B's board invisible to org A's bridged client, so the
      // create_board_view RPC finds no row to insert against.
      expect(result.isError).toBe(true);
    }, 30_000);

    it("refuses to delete another org's view", async () => {
      const secretId = await mintBridgeSecret(tenantA.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageViewHandler(async () => client, {
        action: "delete",
        viewId: tenantB.viewId,
      });

      expect(result.isError).toBe(true);

      // The view must still exist under the admin (service-role) client.
      const { data: stillThere } = await admin
        .from("board_views")
        .select("id")
        .eq("id", tenantB.viewId)
        .maybeSingle();
      expect(stillThere?.id).toBe(tenantB.viewId);
    }, 30_000);
  },
);
