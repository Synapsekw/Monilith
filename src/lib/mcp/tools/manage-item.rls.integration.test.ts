import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";
import { manageItemHandler } from "./manage-item";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type Tenant = { id: string; boardId: string; itemId: string; groupId: string };

describe.skipIf(!integrationTargetReady())(
  "MCP manage_item: RLS still applies (a second org's user cannot archive or move another org's item)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let tenantA: Tenant;
    let tenantB: Tenant;

    // Dynamic import DEFERRED until after loadIntegrationEnv() has overridden
    // process.env — same fix as list-items.rls.integration.test.ts and
    // cross-org-access.rls.integration.test.ts.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    async function provision(label: string): Promise<Tenant> {
      const email = `mcp-manage-item-${label}-${randomUUID()}@example.com`;
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
          p_slug: `mcp-manage-item-${label}-${randomUUID().slice(0, 8)}`,
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

      const { data: group } = await anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .limit(1)
        .single();
      const groupId = (group as { id: string }).id;

      const { data: item } = await anon.rpc("create_item", {
        p_group_id: groupId,
        p_name: `Item ${label}`,
      });
      const itemId = (item as { id: string }).id;

      return { id, boardId, itemId, groupId };
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

    it("archives the caller's own item", async () => {
      const secretId = await mintBridgeSecret(tenantA.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageItemHandler(async () => client, {
        action: "archive",
        itemId: tenantA.itemId,
      });

      expect(result.isError).toBeUndefined();
    }, 30_000);

    it("refuses to archive another org's item — RLS hides the row entirely", async () => {
      const secretId = await mintBridgeSecret(tenantA.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageItemHandler(async () => client, {
        action: "archive",
        itemId: tenantB.itemId,
      });

      // RLS makes org B's item invisible to org A's caller, so the archive RPC
      // (SECURITY INVOKER) finds no matching row and reports failure — never a
      // silent success that would leak the row's existence.
      expect(result.isError).toBe(true);
    }, 30_000);

    it("refuses to move another org's item into the caller's own group", async () => {
      const secretId = await mintBridgeSecret(tenantA.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageItemHandler(async () => client, {
        action: "move",
        itemId: tenantB.itemId,
        groupId: tenantA.groupId,
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(tenantB.groupId);
    }, 30_000);
  },
);
