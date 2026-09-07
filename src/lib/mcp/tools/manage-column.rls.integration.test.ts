import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";
import { manageColumnDescriptor } from "./manage-column";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type Tenant = { id: string; boardId: string };

describe.skipIf(!integrationTargetReady())(
  "MCP manage_column: RLS still applies (a board's column model never crosses orgs)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let tenantA: Tenant;
    let tenantB: Tenant;

    // Dynamic import DEFERRED until after loadIntegrationEnv() has overridden
    // process.env — see list-items.rls.integration.test.ts for why a static
    // import would bake in vitest.setup.ts's placeholder localhost URL.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    async function provision(label: string): Promise<Tenant> {
      const email = `mcp-column-${label}-${randomUUID()}@example.com`;
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
          p_slug: `mcp-column-${label}-${randomUUID().slice(0, 8)}`,
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

      return { id, boardId };
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

    it("refuses to create a column on another org's board", async () => {
      const secretId = await mintBridgeSecret(tenantB.id);
      const { client } = await getBridgedClient(secretId);

      const result = await manageColumnDescriptor.invoke(
        { getClient: async () => client, actorId: tenantB.id },
        {
          action: "create",
          boardId: tenantA.boardId,
          columns: [{ kind: "text" }],
        },
      );

      // RLS makes org A's board invisible to org B, so the board lookup finds
      // nothing — the tool cannot create a column against a board it cannot
      // read even though the caller supplied a real, existing board id.
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toBe("Board not found.");
    }, 30_000);

    it("refuses to delete a column belonging to another org's board", async () => {
      // First, the owning org creates a real column on its own board.
      const ownerSecret = await mintBridgeSecret(tenantA.id);
      const { client: ownerClient } = await getBridgedClient(ownerSecret);
      const created = await manageColumnDescriptor.invoke(
        { getClient: async () => ownerClient, actorId: tenantA.id },
        {
          action: "create",
          boardId: tenantA.boardId,
          columns: [{ kind: "text" }],
        },
      );
      expect(created.isError).toBeUndefined();
      const parsed = JSON.parse(created.content[0]!.text as string) as {
        created: { id: string }[];
      };
      const columnId = parsed.created[0]!.id;

      // Then the other org tries to delete it.
      const attackerSecret = await mintBridgeSecret(tenantB.id);
      const { client: attackerClient } = await getBridgedClient(attackerSecret);
      const result = await manageColumnDescriptor.invoke(
        { getClient: async () => attackerClient, actorId: tenantB.id },
        { action: "delete", columnId },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toBe("Column not found.");
    }, 30_000);
  },
);
