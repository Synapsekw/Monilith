import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

// Proves spec §3.2: the MCP bridged client — anon key + a bearer access token,
// no stored session (`src/lib/mcp/oauth/session-bridge.ts:99`) — can insert the
// `assigned` notification that `upsertCellCore` fans out. Same role, same
// policy as the cookie client; no migration needed.
describe.skipIf(!integrationTargetReady())(
  "RLS: assigned fan-out via a bridged (bearer) client",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    async function makeUser(): Promise<{
      id: string;
      anon: SupabaseClient<Database>;
    }> {
      const email = `mcp-notify-${randomUUID()}@example.com`;
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
      return { id, anon };
    }

    let actor: { id: string; anon: SupabaseClient<Database> };
    let recipient: { id: string; anon: SupabaseClient<Database> };
    let outsider: { id: string; anon: SupabaseClient<Database> };
    let bridged: SupabaseClient<Database>;
    let orgId: string;
    let boardId: string;
    let itemId: string;

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      actor = await makeUser();
      recipient = await makeUser();
      outsider = await makeUser();

      const { data: org } = await actor.anon.rpc("create_organization", {
        p_name: "MCP Notify Org",
        p_slug: `mcp-notify-${randomUUID().slice(0, 8)}`,
      });
      orgId = (org as { id: string }).id;
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: recipient.id, role: "member" });

      const { data: ws } = await actor.anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: actor.id })
        .select("id")
        .single();
      const { data: board } = await actor.anon.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: "Board",
      });
      boardId = (board as { id: string }).id;
      const { data: group } = await actor.anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .limit(1)
        .single();
      const { data: item } = await actor.anon.rpc("create_item", {
        p_group_id: (group as { id: string }).id,
        p_name: "Item",
      });
      itemId = (item as { id: string }).id;

      // The shape getBridgedClient() hands every MCP tool call.
      const { data: session } = await actor.anon.auth.getSession();
      bridged = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${session.session!.access_token}`,
          },
        },
      });
    });

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    });

    it("inserts an assigned notification for a co-member and the recipient sees it", async () => {
      const { error } = await bridged.from("notifications").insert({
        org_id: orgId,
        recipient_id: recipient.id,
        actor_id: actor.id,
        kind: "assigned",
        board_id: boardId,
        item_id: itemId,
      });
      expect(error).toBeNull();

      const { data: seen } = await recipient.anon
        .from("notifications")
        .select("id, kind")
        .eq("item_id", itemId);
      expect(seen ?? []).toHaveLength(1);
      expect(seen![0].kind).toBe("assigned");
    });

    it("rejects the whole batch when one recipient is not an org member", async () => {
      const { error } = await bridged.from("notifications").insert([
        {
          org_id: orgId,
          recipient_id: recipient.id,
          actor_id: actor.id,
          kind: "assigned" as const,
          board_id: boardId,
          item_id: itemId,
        },
        {
          org_id: orgId,
          recipient_id: outsider.id, // not a member → is_member_of() fails
          actor_id: actor.id,
          kind: "assigned" as const,
          board_id: boardId,
          item_id: itemId,
        },
      ]);
      expect(error).not.toBeNull();
    });
  },
);
