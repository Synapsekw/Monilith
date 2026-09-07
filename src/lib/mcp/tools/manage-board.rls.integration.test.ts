import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";
import { manageBoardDescriptor } from "./manage-board";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

const OWNER_ONLY_MESSAGE = "Only the board owner can delete this board.";

describe.skipIf(!integrationTargetReady())(
  "MCP manage_board: archive is owner-only (RLS + defense-in-depth guard both apply)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    let owner: { id: string; orgId: string; boardId: string };
    let outsider: { id: string };
    let outsiderClient: SupabaseClient<Database>;
    let member: { id: string };
    let memberClient: SupabaseClient<Database>;

    // Dynamic import DEFERRED until after loadIntegrationEnv() has overridden
    // process.env — same fix as list-items.rls.integration.test.ts and
    // cross-org-access.rls.integration.test.ts (env.ts caches the URL eagerly
    // at module-evaluation time).
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    async function makeUser(label: string) {
      const email = `mcp-manage-board-${label}-${randomUUID()}@example.com`;
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

    beforeAll(async () => {
      ({ mintBridgeSecret, getBridgedClient } =
        await import("@/lib/mcp/oauth/session-bridge"));
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Owner + their org + a board.
      const o = await makeUser("owner");
      const { data: org } = await o.anon.rpc("create_organization", {
        p_name: "Manage-Board Org",
        p_slug: `manage-board-${randomUUID().slice(0, 8)}`,
      });
      const orgId = (org as { id: string }).id;
      const { data: ws } = await o.anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: o.id })
        .select("id")
        .single();
      const { data: board } = await o.anon.rpc("create_board", {
        p_workspace_id: (ws as { id: string }).id,
        p_name: "Owned Board",
      });
      const boardId = (board as { id: string }).id;
      owner = { id: o.id, orgId, boardId };

      // A second org's user — entirely unrelated tenant.
      const out = await makeUser("outsider");
      outsider = { id: out.id };
      const outsiderSecret = await mintBridgeSecret(outsider.id);
      ({ client: outsiderClient } = await getBridgedClient(outsiderSecret));

      // A MEMBER of the OWNER'S org — granted editor access on the board via
      // `share_board`, so they can read it but do not own it. This is the
      // scenario `deleteBoard`'s defense-in-depth guard exists for: RLS alone
      // permits this member's UPDATE to run (it just matches 0 rows), so
      // without the explicit ownership check the archive would look like a
      // silent, successful no-op instead of a real refusal.
      const mem = await makeUser("member");
      await admin
        .from("org_members")
        .insert([{ org_id: orgId, user_id: mem.id, role: "member" }]);
      await o.anon.rpc("share_board", {
        p_board_id: boardId,
        p_user_id: mem.id,
        p_access: "editor",
      });
      member = { id: mem.id };
      const memberSecret = await mintBridgeSecret(member.id);
      ({ client: memberClient } = await getBridgedClient(memberSecret));
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("refuses a second org's user — the board is invisible to them", async () => {
      const r = await manageBoardDescriptor.invoke(
        { getClient: async () => outsiderClient, actorId: outsider.id },
        { action: "archive", boardId: owner.boardId },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toBe(OWNER_ONLY_MESSAGE);
    }, 30_000);

    it("refuses a non-owner org MEMBER who can otherwise read the board — no lying success", async () => {
      const r = await manageBoardDescriptor.invoke(
        { getClient: async () => memberClient, actorId: member.id },
        { action: "archive", boardId: owner.boardId },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toBe(OWNER_ONLY_MESSAGE);

      // And the board was NOT actually archived by the refused call.
      const { data: stillLive } = await admin
        .from("boards")
        .select("archived_at")
        .eq("id", owner.boardId)
        .single();
      expect(stillLive?.archived_at).toBeNull();
    }, 30_000);
  },
);
