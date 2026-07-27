import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";
import { listItemsHandler } from "./list-items";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type Tenant = { id: string; boardId: string; itemName: string };

describe.skipIf(!integrationTargetReady())(
  "MCP list_items: RLS still applies (a board's items never cross orgs)",
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
    // cross-org-access.rls.integration.test.ts.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    async function provision(label: string): Promise<Tenant> {
      const email = `mcp-list-${label}-${randomUUID()}@example.com`;
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
          p_slug: `mcp-list-${label}-${randomUUID().slice(0, 8)}`,
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

      const itemName = `Secret item ${label} ${randomUUID().slice(0, 8)}`;
      await anon.rpc("create_item", {
        p_group_id: (group as { id: string }).id,
        p_name: itemName,
      });

      return { id, boardId, itemName };
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

    // Anti-vacuity: "returned nothing" is only evidence if the owner CAN see it.
    it("returns the caller's own board items with their cell values", async () => {
      const secretId = await mintBridgeSecret(tenantA.id);
      const { client } = await getBridgedClient(secretId);

      const result = await listItemsHandler(async () => client, {
        boardId: tenantA.boardId,
      });
      const parsed = JSON.parse(result.content[0].text as string);

      expect(result.isError).toBeUndefined();
      expect(parsed.items.map((i: { name: string }) => i.name)).toContain(
        tenantA.itemName,
      );
      expect(parsed.hasMore).toBe(false);
    }, 30_000);

    it("refuses another org's board — items are never returned across tenants", async () => {
      const secretId = await mintBridgeSecret(tenantA.id);
      const { client } = await getBridgedClient(secretId);

      const result = await listItemsHandler(async () => client, {
        boardId: tenantB.boardId,
      });

      // RLS makes org B's board invisible, so the board lookup finds nothing —
      // the tool cannot leak org B's item names even though the caller supplied
      // a real, existing board id.
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Board not found.");
      expect(JSON.stringify(result)).not.toContain(tenantB.itemName);
    }, 30_000);
  },
);
