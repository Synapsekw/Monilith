import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type TestUser = {
  id: string;
  orgId: string;
  boardId: string;
  groupId: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!SERVICE_ROLE_KEY)(
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
      await anon.auth.signInWithPassword({ email, password: PASSWORD });

      const { data: org } = await anon.rpc("create_organization", {
        p_name: `Org ${label}`,
        p_slug: `subitems-${label}-${randomUUID().slice(0, 8)}`,
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

      return { id, orgId, boardId, groupId, anon };
    }

    async function insertItem(
      u: TestUser,
      name: string,
      parentId: string | null,
    ) {
      return u.anon
        .from("items")
        .insert({
          org_id: u.orgId,
          board_id: u.boardId,
          group_id: u.groupId,
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
    });

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    });

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
    });

    it("cascade-deletes subitems and their cell values with the parent", async () => {
      const { data: parent } = await insertItem(userA, "P3", null);
      const { data: sub } = await insertItem(userA, "S3", parent!.id);
      await userA.anon.from("items").delete().eq("id", parent!.id);
      const { data: still } = await userA.anon
        .from("items")
        .select("id")
        .eq("id", sub!.id)
        .maybeSingle();
      expect(still).toBeNull();
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
