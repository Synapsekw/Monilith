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
  anon: SupabaseClient<Database>;
};

describe.skipIf(!integrationTargetReady())(
  "subitems: single-level + cascade + RLS",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let userA: TestUser;
    let userB: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `subitems-${randomUUID()}@example.com`;
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

      const { data: org } = await anon.rpc("create_organization", {
        p_name: `Org ${label}`,
        p_slug: `subitems-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`,
      });
      const orgId = (org as { id: string }).id;

      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;

      const { data: board } = await anon.rpc("create_board", {
        p_workspace_id: workspaceId,
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

      return { id, orgId, workspaceId, boardId, groupId, anon };
    }

    async function insertItem(
      u: TestUser,
      name: string,
      parentId: string | null,
      overrides?: { boardId?: string; groupId?: string },
    ) {
      return u.anon
        .from("items")
        .insert({
          org_id: u.orgId,
          board_id: overrides?.boardId ?? u.boardId,
          group_id: overrides?.groupId ?? u.groupId,
          parent_id: parentId,
          name,
          position: 1,
        })
        .select("*")
        .maybeSingle();
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      userA = await provisionUser("A");
      userB = await provisionUser("B");
    }, 60_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("accepts a subitem under a top-level parent", async () => {
      const { data: parent } = await insertItem(userA, "Parent", null);
      const { data: sub, error } = await insertItem(userA, "Sub", parent!.id);
      expect(error).toBeNull();
      expect(sub!.parent_id).toBe(parent!.id);
    });

    it("rejects nesting a subitem under a subitem (2 levels)", async () => {
      const { data: parent } = await insertItem(userA, "P2", null);
      const { data: sub } = await insertItem(userA, "S2", parent!.id);
      const { error } = await insertItem(userA, "S2.1", sub!.id);
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/nested/i);
    });

    it("rejects self-parenting", async () => {
      const idA = randomUUID();
      const { error } = await userA.anon
        .from("items")
        .insert({
          id: idA,
          org_id: userA.orgId,
          board_id: userA.boardId,
          group_id: userA.groupId,
          parent_id: idA,
          name: "self",
          position: 1,
        })
        .select("*")
        .maybeSingle();
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/own parent/i);
    });

    it("rejects a subitem whose parent lives on a different board", async () => {
      // Provision a second board for userA in the same workspace.
      const { data: board2 } = await userA.anon.rpc("create_board", {
        p_workspace_id: userA.workspaceId,
        p_name: "Board A2",
      });
      const board2Id = (board2 as { id: string }).id;
      const { data: group2 } = await userA.anon
        .from("groups")
        .select("id")
        .eq("board_id", board2Id)
        .limit(1)
        .single();
      const group2Id = (group2 as { id: string }).id;

      // Create a top-level parent on board 1.
      const { data: parentOnBoard1 } = await insertItem(
        userA,
        "Parent-B1",
        null,
      );

      // Attempt to insert a subitem on board 2 that references the board-1 parent.
      const { error } = await userA.anon
        .from("items")
        .insert({
          org_id: userA.orgId,
          board_id: board2Id,
          group_id: group2Id,
          parent_id: parentOnBoard1!.id,
          name: "Cross-board sub",
          position: 1,
        })
        .select("*")
        .maybeSingle();

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/same board/i);
    });

    it("cascade-deletes subitems and their cell values with the parent", async () => {
      const { data: parent } = await insertItem(userA, "P3", null);
      const { data: sub } = await insertItem(userA, "S3", parent!.id);

      // Insert a column on the board so we can create a cell_value.
      const { data: col } = await userA.anon
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

      // Insert a cell_value for the subitem.
      await userA.anon.from("cell_values").insert({
        org_id: userA.orgId,
        board_id: userA.boardId,
        item_id: sub!.id,
        column_id: (col as { id: string }).id,
        value: { text: "x" },
      });

      // Delete the parent — should cascade to subitem and its cell_values.
      await userA.anon.from("items").delete().eq("id", parent!.id);

      // Subitem row must be gone.
      const { data: stillItem } = await userA.anon
        .from("items")
        .select("id")
        .eq("id", sub!.id)
        .maybeSingle();
      expect(stillItem).toBeNull();

      // cell_values for the subitem must also be gone.
      const { data: stillCell } = await userA.anon
        .from("cell_values")
        .select("item_id")
        .eq("item_id", sub!.id)
        .maybeSingle();
      expect(stillCell).toBeNull();
    });

    it("does not let another org read a subitem (RLS)", async () => {
      const { data: parent } = await insertItem(userA, "P4", null);
      const { data: sub } = await insertItem(userA, "S4", parent!.id);
      const { data: leaked } = await userB.anon
        .from("items")
        .select("id")
        .eq("id", sub!.id)
        .maybeSingle();
      expect(leaked).toBeNull();
    });
  },
);
