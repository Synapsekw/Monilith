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

// EXPECTED-RED until 20260704110000_dashboard_rpc_board_read_guards.sql is
// applied. The five dashboard read RPCs guard only on is_org_member(org_id);
// this suite asserts that a same-org member WITHOUT a board_members grant is
// denied (42501) on a PRIVATE board. Before the migration each RPC returns data
// (error === null) and every `.code` assertion below fails — that is the
// intended TDD-red, and it fails for the right reason (no guard raised yet).
describe.skipIf(!integrationTargetReady())(
  "RLS: dashboard read RPCs honor board-level sharing",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    let owner: {
      id: string;
      orgId: string;
      boardId: string;
      anon: SupabaseClient<Database>;
    };
    let member: { id: string; anon: SupabaseClient<Database> };

    async function makeUser(label: string) {
      const email = `dashguard-${label}-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, `createUser(${label})`).toBeNull();
      const id = created.user!.id;
      createdUserIds.push(id);
      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
      return { id, email, anon };
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const o = await makeUser("owner");
      const { data: org } = await o.anon.rpc("create_organization", {
        p_name: "Dash Guard Org",
        p_slug: `dashg-${randomUUID().slice(0, 8)}`,
      });
      const orgId = (org as { id: string }).id;
      const { data: ws } = await o.anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: o.id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;
      const { data: board } = await o.anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: "Private Board",
      });
      const boardId = (board as { id: string }).id;
      const { data: group } = await o.anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      const groupId = (group as { id: string }).id;
      await o.anon.rpc("create_item", { p_group_id: groupId, p_name: "Item" });
      owner = { id: o.id, orgId, boardId, anon: o.anon };

      // A same-org member with NO board_members grant on the private board.
      const m = await makeUser("member");
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: m.id, role: "member" });
      member = { id: m.id, anon: m.anon };
    }, 90_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("the owner CAN read its own private board's dashboard aggregate", async () => {
      const { error } = await owner.anon.rpc("dashboard_aggregate", {
        p_board_id: owner.boardId,
      });
      expect(error, "owner dashboard_aggregate").toBeNull();
    });

    it("dashboard_aggregate is denied to an ungranted member", async () => {
      const { error } = await member.anon.rpc("dashboard_aggregate", {
        p_board_id: owner.boardId,
      });
      expect(error?.code, "dashboard_aggregate").toBe("42501");
    });

    it("dashboard_list_rows is denied to an ungranted member", async () => {
      const { error } = await member.anon.rpc("dashboard_list_rows", {
        p_board_id: owner.boardId,
      });
      expect(error?.code, "dashboard_list_rows").toBe("42501");
    });

    it("dashboard_series is denied to an ungranted member", async () => {
      const { error } = await member.anon.rpc("dashboard_series", {
        p_board_id: owner.boardId,
        p_primary: { kind: "date" },
      });
      expect(error?.code, "dashboard_series").toBe("42501");
    });

    it("dashboard_completion is denied to an ungranted member", async () => {
      const { error } = await member.anon.rpc("dashboard_completion", {
        p_board_id: owner.boardId,
        p_mode: "percent",
        p_value_column_id: randomUUID(),
      });
      expect(error?.code, "dashboard_completion").toBe("42501");
    });

    it("dashboard_health_summary is denied to an ungranted member", async () => {
      const { error } = await member.anon.rpc("dashboard_health_summary", {
        p_board_id: owner.boardId,
      });
      expect(error?.code, "dashboard_health_summary").toBe("42501");
    });
  },
);
