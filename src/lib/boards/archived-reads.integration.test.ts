import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

// getBoardPayload reads through the cookie-bound server client + the session
// helper. In the integration harness there is no request context, so we mock
// both to route through a real, signed-in anon client (mutated in beforeAll).
// This exercises the ACTUAL query in queries.ts against the real DB + RLS.
const ctx: { client: SupabaseClient<Database> | null; userId: string } = {
  client: null,
  userId: "",
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ctx.client,
}));
vi.mock("@/lib/auth/session", () => ({
  getUser: async () => ({ id: ctx.userId }),
}));

// vi.mock calls above are hoisted, so this static import binds getBoardPayload
// to the mocked server client + session (same pattern as queries.payload.test.ts).
import { getBoardPayload } from "@/lib/boards/queries";

describe.skipIf(!integrationTargetReady())(
  "archived reads: getBoardPayload excludes archived rows",
  () => {
    let admin: SupabaseClient<Database>;
    let anon: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let orgId: string;
    let boardId: string;
    let groupId: string;

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const email = `archived-reads-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, "createUser").toBeNull();
      const userId = created.user!.id;
      createdUserIds.push(userId);

      anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });

      const { data: org } = await anon.rpc("create_organization", {
        p_name: "Org Archived",
        p_slug: `archived-reads-${randomUUID().slice(0, 8)}`,
      });
      orgId = (org as { id: string }).id;

      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: userId })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;

      const { data: board } = await anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: "Board Archived",
      });
      boardId = (board as { id: string }).id;

      const { data: group } = await anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .limit(1)
        .single();
      groupId = (group as { id: string }).id;

      ctx.client = anon;
      ctx.userId = userId;
    }, 60_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("returns only the live item, never the archived one", async () => {
      const { data: live, error: liveErr } = await anon
        .from("items")
        .insert({
          org_id: orgId,
          board_id: boardId,
          group_id: groupId,
          name: "Live item",
          position: 1,
        })
        .select("id")
        .single();
      expect(liveErr, "insert live item").toBeNull();

      const { data: archived, error: archErr } = await anon
        .from("items")
        .insert({
          org_id: orgId,
          board_id: boardId,
          group_id: groupId,
          name: "Archived item",
          position: 2,
        })
        .select("id")
        .single();
      expect(archErr, "insert archived item").toBeNull();

      // Archive the second item via the cascade RPC (real archive path).
      const { error: rpcErr } = await anon.rpc("archive_item", {
        p_item_id: (archived as { id: string }).id,
      });
      expect(rpcErr, "archive_item").toBeNull();

      const payload = await getBoardPayload(boardId);
      expect(payload, "board payload present").not.toBeNull();

      const ids = (payload?.items ?? []).map((i) => i.id);
      expect(ids).toContain((live as { id: string }).id);
      expect(ids).not.toContain((archived as { id: string }).id);
    }, 30_000);
  },
);
