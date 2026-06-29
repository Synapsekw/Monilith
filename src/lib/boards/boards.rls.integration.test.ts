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
  "RLS: boards tenant isolation",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let userA: TestUser;
    let userB: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-boards-${randomUUID()}@example.com`;
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
        p_slug: `rls-b-${label}-${randomUUID().slice(0, 8)}`,
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

    it("create_board auto-seeds Group 1 + Status/Owner/Date", async () => {
      const { data: groups } = await userA.anon
        .from("groups")
        .select("name")
        .eq("board_id", userA.boardId);
      expect(groups).toEqual([{ name: "Group 1" }]);

      const { data: cols } = await userA.anon
        .from("columns")
        .select("name, kind")
        .eq("board_id", userA.boardId)
        .order("position");
      expect(cols).toEqual([
        { name: "Status", kind: "status" },
        { name: "Owner", kind: "people" },
        { name: "Date", kind: "date" },
      ]);
    });

    it("create_board seeds three default Status options", async () => {
      const { data: status } = await userA.anon
        .from("columns")
        .select("settings")
        .eq("board_id", userA.boardId)
        .eq("kind", "status")
        .single();
      const options = (
        status as {
          settings: { options: { id: string; label: string; color: string }[] };
        }
      ).settings.options;
      expect(options).toHaveLength(3);
      expect(options.map((o) => o.label)).toEqual([
        "Working on it",
        "Stuck",
        "Done",
      ]);
      // Each option must have id, label, and color.
      for (const o of options) {
        expect(o.id).toBeTruthy();
        expect(o.label).toBeTruthy();
        expect(o.color).toBeTruthy();
      }
    });

    it("a member can upsert a cell on their own board's item/column", async () => {
      const { data: col } = await userA.anon
        .from("columns")
        .select("id")
        .eq("board_id", userA.boardId)
        .eq("kind", "status")
        .single();
      const columnId = (col as { id: string }).id;

      const { error } = await userA.anon.from("cell_values").insert({
        org_id: userA.orgId,
        board_id: userA.boardId,
        item_id: userA.itemId,
        column_id: columnId,
        value: { optionId: null },
      });
      expect(error).toBeNull();
    });

    it("org A cannot upsert a cell on org B's item/column", async () => {
      const { data: colB } = await userB.anon
        .from("columns")
        .select("id")
        .eq("board_id", userB.boardId)
        .eq("kind", "status")
        .single();
      const columnIdB = (colB as { id: string }).id;

      // Even with A's own org_id, the parent-org WITH CHECK rejects B's item/column.
      const { error } = await userA.anon.from("cell_values").insert({
        org_id: userA.orgId,
        board_id: userB.boardId,
        item_id: userB.itemId,
        column_id: columnIdB,
        value: { optionId: null },
      });
      expect(error).not.toBeNull();
    });

    it("org A cannot read org B's boards/groups/items/columns", async () => {
      const { data: bData } = await userA.anon
        .from("boards")
        .select("*")
        .eq("id", userB.boardId);
      expect(bData, "read boards").toEqual([]);

      for (const table of ["groups", "items", "columns"] as const) {
        const { data } = await userA.anon
          .from(table)
          .select("*")
          .eq("board_id", userB.boardId);
        expect(data, `read ${table}`).toEqual([]);
      }
    });

    it("org A cannot read org B's cell_values", async () => {
      const { data } = await userA.anon
        .from("cell_values")
        .select("*")
        .eq("board_id", userB.boardId);
      expect(data).toEqual([]);
    });

    it("org A cannot rename org B's board (update affects 0 rows)", async () => {
      const { error } = await userA.anon
        .from("boards")
        .update({ name: "hacked" })
        .eq("id", userB.boardId);
      expect(error).toBeNull(); // RLS hides the row → 0 rows updated, no error
      const { data } = await userB.anon
        .from("boards")
        .select("name")
        .eq("id", userB.boardId)
        .single();
      expect((data as { name: string }).name).toBe("Board b");
    });

    it("cross-org org_id forgery on insert is rejected", async () => {
      const { error } = await userA.anon.from("groups").insert({
        org_id: userB.orgId, // forge B's org
        board_id: userA.boardId,
        name: "forged",
      });
      expect(error).not.toBeNull(); // with check (is_org_member(org_id)) fails
    });

    it("create_item via RPC cannot target another org's group", async () => {
      const { error } = await userA.anon.rpc("create_item", {
        p_group_id: userB.groupId,
        p_name: "intruder",
      });
      expect(error).not.toBeNull();
    });

    it("board delete is denied for a non-admin member", async () => {
      // Add a plain 'member' of org A, then try to delete A's board.
      const memberEmail = `rls-member-${randomUUID()}@example.com`;
      const { data: created } = await admin.auth.admin.createUser({
        email: memberEmail,
        password: PASSWORD,
        email_confirm: true,
      });
      const memberId = created.user!.id;
      createdUserIds.push(memberId);
      await admin
        .from("org_members")
        .insert({ org_id: userA.orgId, user_id: memberId, role: "member" });

      const memberAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(memberAnon, {
        email: memberEmail,
        password: PASSWORD,
      });

      await memberAnon.from("boards").delete().eq("id", userA.boardId);
      // The board must still exist (delete policy requires owner/admin).
      const { data: still } = await userA.anon
        .from("boards")
        .select("id")
        .eq("id", userA.boardId);
      expect(still).toHaveLength(1);
    });

    it("cannot attach a group to another org's board even with own org_id", async () => {
      // This tests the parent-org-consistency WITH CHECK: board_in_org(B_board, A_org)
      // is false, so the insert must be rejected even though A's own org_id passes
      // the is_org_member check.
      const { error } = await userA.anon.from("groups").insert({
        org_id: userA.orgId, // A's OWN valid org — is_org_member passes
        board_id: userB.boardId, // but the board belongs to B
        name: "poison",
      });
      expect(error).not.toBeNull(); // board_in_org(B_board, A_org) is false → rejected
    });

    describe("item_dependencies RLS", () => {
      // Two items on userA's board, created fresh for these tests.
      let itemA1: string;
      let itemA2: string;
      // An item on a second board (same org as userA) for the same-board guard test.
      let itemA3OnBoard2: string;

      beforeAll(async () => {
        // Create two items on userA's existing board.
        const { data: ia1 } = await userA.anon.rpc("create_item", {
          p_group_id: userA.groupId,
          p_name: "Dep Item 1",
        });
        itemA1 = (ia1 as { id: string }).id;

        const { data: ia2 } = await userA.anon.rpc("create_item", {
          p_group_id: userA.groupId,
          p_name: "Dep Item 2",
        });
        itemA2 = (ia2 as { id: string }).id;

        // Create a second board in userA's org to test the same-board guard.
        const { data: board2 } = await userA.anon.rpc("create_board", {
          p_workspace_id: userA.workspaceId,
          p_name: "Board a2",
        });
        const board2Id = (board2 as { id: string }).id;

        const { data: group2 } = await userA.anon
          .from("groups")
          .select("id")
          .eq("board_id", board2Id)
          .single();
        const group2Id = (group2 as { id: string }).id;

        const { data: ia3 } = await userA.anon.rpc("create_item", {
          p_group_id: group2Id,
          p_name: "Dep Item 3 (board2)",
        });
        itemA3OnBoard2 = (ia3 as { id: string }).id;
      }, 30_000);

      it("a member can read own-org dependencies", async () => {
        // Seed a dependency as userA so the select has something to find.
        const { error: seedErr } = await userA.anon.rpc(
          "create_item_dependency",
          { p_predecessor: itemA1, p_successor: itemA2 },
        );
        expect(seedErr).toBeNull();

        const { data, error } = await userA.anon
          .from("item_dependencies")
          .select("*")
          .eq("board_id", userA.boardId);
        expect(error).toBeNull();
        expect((data ?? []).length).toBeGreaterThan(0);
      });

      it("a cross-org read of item_dependencies returns []", async () => {
        const { data } = await userB.anon
          .from("item_dependencies")
          .select("*")
          .eq("board_id", userA.boardId);
        expect(data ?? []).toHaveLength(0);
      });

      it("create_item_dependency returns a row with type FS", async () => {
        // Create two fresh items so we have a clean pair with no existing dep.
        const { data: iX } = await userA.anon.rpc("create_item", {
          p_group_id: userA.groupId,
          p_name: "Dep FS X",
        });
        const { data: iY } = await userA.anon.rpc("create_item", {
          p_group_id: userA.groupId,
          p_name: "Dep FS Y",
        });
        const idX = (iX as { id: string }).id;
        const idY = (iY as { id: string }).id;

        const { data, error } = await userA.anon.rpc("create_item_dependency", {
          p_predecessor: idX,
          p_successor: idY,
        });
        expect(error).toBeNull();
        expect(data).toMatchObject({ type: "FS" });
      });

      it("create_item_dependency(a, a) raises a self-link error", async () => {
        const { error } = await userA.anon.rpc("create_item_dependency", {
          p_predecessor: itemA1,
          p_successor: itemA1,
        });
        expect(error).not.toBeNull();
      });

      it("create_item_dependency(b, a) raises a cycle error after (a, b) exists", async () => {
        // itemA1 → itemA2 was created in the first test above; b→a would cycle.
        const { error } = await userA.anon.rpc("create_item_dependency", {
          p_predecessor: itemA2,
          p_successor: itemA1,
        });
        expect(error).not.toBeNull();
      });

      it("a non-member / forged direct insert into item_dependencies is rejected by RLS", async () => {
        // userA tries to insert directly into item_dependencies on userB's board.
        // is_org_member(userB.orgId) is false for userA → RLS WITH CHECK rejects.
        const { error } = await userA.anon.from("item_dependencies").insert({
          org_id: userB.orgId,
          board_id: userB.boardId,
          predecessor_id: userB.itemId,
          successor_id: userB.itemId,
        });
        expect(error).not.toBeNull();
      });

      it("create_item_dependency with items from two different boards raises a same-board error", async () => {
        // itemA1 is on userA.boardId; itemA3OnBoard2 is on a second board in the same org.
        const { error } = await userA.anon.rpc("create_item_dependency", {
          p_predecessor: itemA1,
          p_successor: itemA3OnBoard2,
        });
        expect(error).not.toBeNull();
      });
    });

    describe("board_views RLS", () => {
      it("a member can read their org's board_views", async () => {
        const { data, error } = await userA.anon
          .from("board_views")
          .select("*")
          .eq("board_id", userA.boardId);
        expect(error).toBeNull();
        expect(data ?? []).toHaveLength(1);
      });

      it("a non-member's read of another org's board_views returns 0 rows", async () => {
        const { data } = await userA.anon
          .from("board_views")
          .select("*")
          .eq("board_id", userB.boardId);
        expect(data ?? []).toHaveLength(0);
      });

      it("a non-member insert into another org's board is rejected by RLS", async () => {
        // A forges B's org_id + board_id; is_org_member(B_org) fails for A.
        const { error } = await userA.anon.from("board_views").insert({
          org_id: userB.orgId,
          board_id: userB.boardId,
          kind: "kanban",
          name: "intruder",
        });
        expect(error).not.toBeNull();
      });

      it("create_board seeds exactly one table view (Main Table, position 0)", async () => {
        const { data } = await admin
          .from("board_views")
          .select("*")
          .eq("board_id", userA.boardId);
        expect(data).toHaveLength(1);
        expect(data![0]).toMatchObject({
          kind: "table",
          name: "Main Table",
          position: 0,
        });
      });

      it("create_board_view appends at max+1 for members and rejects non-members", async () => {
        const { data, error } = await userA.anon.rpc("create_board_view", {
          p_board_id: userA.boardId,
          p_kind: "kanban",
          p_name: "Kanban",
          p_config: {},
        });
        expect(error).toBeNull();
        expect(data).toMatchObject({ kind: "kanban", position: 1 });

        const denied = await userB.anon.rpc("create_board_view", {
          p_board_id: userA.boardId,
          p_kind: "kanban",
          p_name: "Kanban",
          p_config: {},
        });
        expect(denied.error).not.toBeNull();
      });
    });
  },
);
