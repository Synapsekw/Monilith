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

type TestUser = {
  id: string;
  orgId: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  itemId: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!integrationTargetReady())(
  "time_entries RLS + start_timer (6c)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let owner: TestUser;
    let outsider: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-time-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
      expect(createErr, `createUser(${label})`).toBeNull();
      const id = created.user!.id;
      createdUserIds.push(id);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });

      const { data: org } = await anon.rpc("create_organization", {
        p_name: `Org ${label}`,
        p_slug: `time-${label}-${randomUUID().slice(0, 8)}`,
      });
      const orgId = (org as { id: string }).id;

      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;

      const { data: board, error: boardErr } = await anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: `Board ${label}`,
      });
      expect(boardErr, `create_board(${label})`).toBeNull();
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

      return { id, orgId, workspaceId, boardId, groupId, itemId, anon };
    }

    async function timeColumn(u: TestUser): Promise<string> {
      const { data } = await u.anon
        .from("columns")
        .insert({
          org_id: u.orgId,
          board_id: u.boardId,
          kind: "time_tracking",
          name: "Time",
          settings: {},
          position: 99,
        })
        .select("id")
        .single();
      return (data as { id: string }).id;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      owner = await provisionUser("a");
      outsider = await provisionUser("b");
    }, 60_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("start_timer stops the running entry and starts a new one atomically", async () => {
      const columnId = await timeColumn(owner);
      // seed a running entry 60s ago
      const { data: first } = await owner.anon
        .from("time_entries")
        .insert({
          org_id: owner.orgId,
          board_id: owner.boardId,
          item_id: owner.itemId,
          column_id: columnId,
          user_id: owner.id,
          started_at: new Date(Date.now() - 62_000).toISOString(),
        })
        .select("id")
        .single();

      const { data: rows, error } = await owner.anon.rpc("start_timer", {
        p_item_id: owner.itemId,
        p_column_id: columnId,
      });
      expect(error).toBeNull();
      const list = rows as {
        id: string;
        ended_at: string | null;
        duration_secs: number | null;
      }[];
      // exactly one running row remains for the user
      const running = list.filter((r) => r.ended_at === null);
      expect(running).toHaveLength(1);

      const { data: stopped } = await owner.anon
        .from("time_entries")
        .select("ended_at, duration_secs")
        .eq("id", (first as { id: string }).id)
        .single();
      expect(stopped!.ended_at).not.toBeNull();
      expect(stopped!.duration_secs).toBeGreaterThanOrEqual(60);

      // global invariant: never two running rows for one user
      const { data: allRunning } = await owner.anon
        .from("time_entries")
        .select("id")
        .eq("user_id", owner.id)
        .is("ended_at", null);
      expect(allRunning ?? []).toHaveLength(1);
    });

    it("an outsider cannot read another org's entries", async () => {
      const columnId = await timeColumn(owner);
      await owner.anon.rpc("start_timer", {
        p_item_id: owner.itemId,
        p_column_id: columnId,
      });
      const { data } = await outsider.anon
        .from("time_entries")
        .select("id")
        .eq("board_id", owner.boardId);
      expect(data ?? []).toHaveLength(0);

      // proof-of-life: the row genuinely exists (the owner can read it), so the
      // outsider's empty result is RLS isolation, not a missing/never-inserted row.
      const { data: ownerSee } = await owner.anon
        .from("time_entries")
        .select("id")
        .eq("board_id", owner.boardId);
      expect((ownerSee ?? []).length).toBeGreaterThan(0);
    });

    it("a user cannot delete another user's entry", async () => {
      const columnId = await timeColumn(owner);
      const { data: e } = await owner.anon
        .from("time_entries")
        .insert({
          org_id: owner.orgId,
          board_id: owner.boardId,
          item_id: owner.itemId,
          column_id: columnId,
          user_id: owner.id,
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration_secs: 10,
        })
        .select("id")
        .single();
      await outsider.anon
        .from("time_entries")
        .delete()
        .eq("id", (e as { id: string }).id);
      const { data: still } = await owner.anon
        .from("time_entries")
        .select("id")
        .eq("id", (e as { id: string }).id)
        .maybeSingle();
      expect(still).not.toBeNull();
    });

    it("the check constraint rejects a completed entry with no duration", async () => {
      const columnId = await timeColumn(owner);
      const { error } = await owner.anon.from("time_entries").insert({
        org_id: owner.orgId,
        board_id: owner.boardId,
        item_id: owner.itemId,
        column_id: columnId,
        user_id: owner.id,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_secs: null,
      });
      expect(error).not.toBeNull();
    });
  },
);
