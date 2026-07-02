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
  "RLS: columns tenant isolation",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let userA: TestUser;
    let userB: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-columns-${randomUUID()}@example.com`;
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
        p_slug: `rls-c-${label}-${randomUUID().slice(0, 8)}`,
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
        .single();
      const groupId = (group as { id: string }).id;

      const { data: item } = await anon.rpc("create_item", {
        p_group_id: groupId,
        p_name: `Item ${label}`,
      });
      const itemId = (item as { id: string }).id;

      return { id, orgId, workspaceId, boardId, groupId, itemId, anon };
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      userA = await provisionUser("a");
      userB = await provisionUser("b");
    }, 60_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("a member can create, rename, resize, then delete a column", async () => {
      const { data: created, error } = await userA.anon
        .from("columns")
        .insert({
          org_id: userA.orgId,
          board_id: userA.boardId,
          kind: "text",
          name: "Notes",
          settings: {},
          position: 99,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      const id = (created as { id: string }).id;

      expect(
        (
          await userA.anon
            .from("columns")
            .update({ name: "Renamed" })
            .eq("id", id)
        ).error,
      ).toBeNull();
      expect(
        (await userA.anon.from("columns").update({ width: 300 }).eq("id", id))
          .error,
      ).toBeNull();
      expect(
        (await userA.anon.from("columns").delete().eq("id", id)).error,
      ).toBeNull();
    });

    it("can delete a column that has logged cell activity (regression: FK 23503)", async () => {
      // Repro for the pre-existing bug fixed in migration 20260621150000: setting a
      // cell value logs an item_activities row (tg_log_cell_activity INSERT branch);
      // deleting the column cascades its cell_values, firing the DELETE branch, which
      // used to log a row referencing the column being dropped → item_activities
      // column_id FK (on delete set null) rejected it with 23503 → the delete aborted.
      const { data: created, error: createErr } = await userA.anon
        .from("columns")
        .insert({
          org_id: userA.orgId,
          board_id: userA.boardId,
          kind: "text",
          name: "Activity Notes",
          settings: {},
          position: 98,
        })
        .select("id")
        .single();
      expect(createErr).toBeNull();
      const columnId = (created as { id: string }).id;

      // Set a cell value → logs cell activity referencing this column.
      const { error: cellErr } = await userA.anon.from("cell_values").insert({
        org_id: userA.orgId,
        board_id: userA.boardId,
        item_id: userA.itemId,
        column_id: columnId,
        value: { text: "logged" },
      });
      expect(cellErr).toBeNull();

      // Deleting the column must now succeed (the cell_values cascade no longer
      // tries to log against the column being dropped).
      const { error: delErr } = await userA.anon
        .from("columns")
        .delete()
        .eq("id", columnId);
      expect(delErr).toBeNull();

      // The cell cascaded away.
      const { data: cells } = await userA.anon
        .from("cell_values")
        .select("column_id")
        .eq("item_id", userA.itemId)
        .eq("column_id", columnId);
      expect(cells ?? []).toHaveLength(0);
    });

    it("a different org cannot create or read another org's column", async () => {
      // userB inserts into userA's board/org → RLS with_check denies.
      const { error: insErr } = await userB.anon.from("columns").insert({
        org_id: userA.orgId,
        board_id: userA.boardId,
        kind: "text",
        name: "Evil",
        settings: {},
        position: 1,
      });
      expect(insErr).not.toBeNull();

      // And cannot see userA's seeded columns.
      const { data } = await userB.anon
        .from("columns")
        .select("id")
        .eq("board_id", userA.boardId);
      expect(data ?? []).toHaveLength(0);
    });
  },
);
