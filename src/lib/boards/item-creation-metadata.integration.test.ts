import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

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

describe.skipIf(!SERVICE_ROLE_KEY)(
  "item creation metadata: attribution + immutability",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let userA: TestUser;
    let userB: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `item-meta-${randomUUID()}@example.com`;
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
        p_slug: `item-meta-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`,
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

    it("attributes a new item to the authenticated creator", async () => {
      const before = Date.now();
      const { data: item, error } = await insertItem(userA, "Owned", null);
      expect(error).toBeNull();
      expect(item!.created_by).toBe(userA.id);
      expect(new Date(item!.created_at).getTime()).toBeGreaterThanOrEqual(
        before - 5_000,
      );
    });

    it("ignores a client-supplied created_by (anti-spoof)", async () => {
      // Try to forge attribution to userB while signed in as userA.
      const { data: item, error } = await userA.anon
        .from("items")
        .insert({
          org_id: userA.orgId,
          board_id: userA.boardId,
          group_id: userA.groupId,
          parent_id: null,
          name: "Forged",
          position: 1,
          created_by: userB.id, // forged — trigger must override
        })
        .select("*")
        .single();
      expect(error).toBeNull();
      expect(item!.created_by).toBe(userA.id);
    });

    it("attributes a subitem to its creator", async () => {
      const { data: parent } = await insertItem(userA, "P-meta", null);
      const { data: sub, error } = await insertItem(
        userA,
        "S-meta",
        parent!.id,
      );
      expect(error).toBeNull();
      expect(sub!.created_by).toBe(userA.id);
    });

    it("keeps created_by/created_at immutable on update", async () => {
      const { data: item } = await insertItem(userA, "Immutable", null);
      const originalBy = item!.created_by;
      const originalAt = item!.created_at;

      // A normal rename must not touch the audit fields.
      await userA.anon
        .from("items")
        .update({ name: "Renamed" })
        .eq("id", item!.id);
      // An explicit attempt to rewrite the audit fields must be silently preserved.
      await userA.anon
        .from("items")
        .update({ created_by: userB.id, created_at: "2000-01-01T00:00:00Z" })
        .eq("id", item!.id);

      const { data: after } = await userA.anon
        .from("items")
        .select("created_by, created_at, name")
        .eq("id", item!.id)
        .single();
      expect(after!.name).toBe("Renamed");
      expect(after!.created_by).toBe(originalBy);
      expect(after!.created_at).toBe(originalAt);
    });
  },
);
