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

describe.skipIf(!SERVICE_ROLE_KEY)(
  "RLS: relation_links + set_relation_links (cross-board)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    // owner: org + board A (owning) + board B (target). outsider: org member,
    // shared into A as VIEWER, NOT a member of B.
    let owner: SupabaseClient<Database>;
    let outsider: SupabaseClient<Database>;
    let orgId: string;
    let itemA: string; // owning item on board A
    let relMulti: string; // relation column on A → B, allow_multiple=true
    let relSingle: string; // relation column on A → B, allow_multiple=false
    let b1: string;
    let b2: string;

    async function makeUser(label: string) {
      const email = `rel-${label}-${randomUUID()}@example.com`;
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
      return { id, anon };
    }

    async function makeBoard(
      client: SupabaseClient<Database>,
      workspaceId: string,
      name: string,
    ) {
      const { data: board } = await client.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: name,
      });
      const boardId = (board as { id: string }).id;
      const { data: group } = await client
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      return { boardId, groupId: (group as { id: string }).id };
    }

    async function makeItem(
      client: SupabaseClient<Database>,
      groupId: string,
      name: string,
    ) {
      const { data: item } = await client.rpc("create_item", {
        p_group_id: groupId,
        p_name: name,
      });
      return (item as { id: string }).id;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const o = await makeUser("owner");
      owner = o.anon;
      const { data: org } = await o.anon.rpc("create_organization", {
        p_name: "Rel Org",
        p_slug: `rel-${randomUUID().slice(0, 8)}`,
      });
      orgId = (org as { id: string }).id;
      const { data: ws } = await o.anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: o.id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;

      const boardA = await makeBoard(o.anon, workspaceId, "Tasks");
      const boardB = await makeBoard(o.anon, workspaceId, "Projects");
      itemA = await makeItem(o.anon, boardA.groupId, "Ship onboarding");
      b1 = await makeItem(o.anon, boardB.groupId, "Acquisition Q3");
      b2 = await makeItem(o.anon, boardB.groupId, "Mobile App");

      const { data: cols, error: colErr } = await o.anon
        .from("columns")
        .insert([
          {
            org_id: orgId,
            board_id: boardA.boardId,
            name: "Projects",
            kind: "relation",
            position: 1000,
            settings: { target_board_id: boardB.boardId, allow_multiple: true },
          },
          {
            org_id: orgId,
            board_id: boardA.boardId,
            name: "Primary project",
            kind: "relation",
            position: 1001,
            settings: { target_board_id: boardB.boardId, allow_multiple: false },
          },
        ])
        .select("id, position");
      expect(colErr, "insert relation columns").toBeNull();
      const sorted = (cols as { id: string; position: number }[]).sort(
        (a, b) => a.position - b.position,
      );
      relMulti = sorted[0].id;
      relSingle = sorted[1].id;

      // outsider: org member, shared into board A as VIEWER, not a member of B.
      const out = await makeUser("outsider");
      outsider = out.anon;
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: out.id, role: "member" });
      const { error: shareErr } = await o.anon.from("board_members").insert({
        board_id: boardA.boardId,
        org_id: orgId,
        user_id: out.id,
        access_level: "viewer",
        granted_by: o.id,
      });
      expect(shareErr, "share board A with outsider as viewer").toBeNull();
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("owner links target-board items and reads them back", async () => {
      const { data, error } = await owner.rpc("set_relation_links", {
        p_item_id: itemA,
        p_column_id: relMulti,
        p_linked_item_ids: [b1, b2],
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    });

    it("rejects multiple ids when allow_multiple is false", async () => {
      const { error } = await owner.rpc("set_relation_links", {
        p_item_id: itemA,
        p_column_id: relSingle,
        p_linked_item_ids: [b1, b2],
      });
      expect(error).not.toBeNull();
    });

    it("rejects a self-link", async () => {
      const { error } = await owner.rpc("set_relation_links", {
        p_item_id: itemA,
        p_column_id: relMulti,
        p_linked_item_ids: [itemA],
      });
      expect(error).not.toBeNull();
    });

    it("rejects an id that is not on the target board", async () => {
      const { error } = await owner.rpc("set_relation_links", {
        p_item_id: itemA,
        p_column_id: relMulti,
        p_linked_item_ids: [randomUUID()],
      });
      expect(error).not.toBeNull();
    });

    it("a viewer of board A can read link rows but not the linked-item name", async () => {
      // (re-link first so there are rows to read)
      await owner.rpc("set_relation_links", {
        p_item_id: itemA,
        p_column_id: relMulti,
        p_linked_item_ids: [b1, b2],
      });
      const { data, error } = await outsider
        .from("relation_links")
        .select(
          "id, linked_item_id, items!relation_links_linked_item_id_fkey(name)",
        )
        .eq("item_id", itemA)
        .eq("column_id", relMulti);
      expect(error).toBeNull();
      expect(data).toHaveLength(2); // link rows visible (board A readable)
      // linked item lives on board B which the outsider can't read → name null
      for (const row of data ?? []) {
        expect(
          (row as { items: { name: string } | null }).items,
        ).toBeNull();
      }
    });

    it("denies set_relation_links to a viewer of the owning board", async () => {
      const { error } = await outsider.rpc("set_relation_links", {
        p_item_id: itemA,
        p_column_id: relMulti,
        p_linked_item_ids: [b1],
      });
      expect(error).not.toBeNull();
    });

    it("cascades link rows when a linked target item is deleted", async () => {
      await owner.rpc("set_relation_links", {
        p_item_id: itemA,
        p_column_id: relMulti,
        p_linked_item_ids: [b1, b2],
      });
      const { error: delErr } = await owner.from("items").delete().eq("id", b2);
      expect(delErr).toBeNull();
      const { data } = await owner
        .from("relation_links")
        .select("linked_item_id")
        .eq("item_id", itemA)
        .eq("column_id", relMulti);
      const ids = (data ?? []).map((r) => r.linked_item_id);
      expect(ids).toContain(b1);
      expect(ids).not.toContain(b2);
    });
  },
);
