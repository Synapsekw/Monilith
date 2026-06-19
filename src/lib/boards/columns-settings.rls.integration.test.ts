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
  workspaceId: string;
  boardId: string;
  groupId: string;
  itemId: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!SERVICE_ROLE_KEY)(
  "delete_column_option RPC (G1 column settings)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let owner: TestUser;
    let outsider: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-colset-${randomUUID()}@example.com`;
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
      await anon.auth.signInWithPassword({ email, password: PASSWORD });

      const { data: org } = await anon.rpc("create_organization", {
        p_name: `Org ${label}`,
        p_slug: `colset-${label}-${randomUUID().slice(0, 8)}`,
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

    it("clears a referencing status cell, removes the option, and deletes the cell", async () => {
      // Seed a status column with one option, then a cell referencing it.
      const { data: col, error: colErr } = await owner.anon
        .from("columns")
        .insert({
          org_id: owner.orgId,
          board_id: owner.boardId,
          kind: "status",
          name: "Status",
          settings: {
            options: [{ id: "opt-1", label: "Done", color: "#00c875" }],
          },
          position: 99,
        })
        .select("id")
        .single();
      expect(colErr).toBeNull();
      const columnId = (col as { id: string }).id;

      const { error: cellErr } = await owner.anon.from("cell_values").insert({
        org_id: owner.orgId,
        board_id: owner.boardId,
        item_id: owner.itemId,
        column_id: columnId,
        value: { optionId: "opt-1" },
      });
      expect(cellErr).toBeNull();

      const { data: cleared, error: rpcErr } = await owner.anon.rpc(
        "delete_column_option",
        { p_column_id: columnId, p_option_id: "opt-1" },
      );
      expect(rpcErr).toBeNull();
      expect(cleared).toBe(1);

      // The option is gone from the column settings.
      const { data: after } = await owner.anon
        .from("columns")
        .select("settings")
        .eq("id", columnId)
        .single();
      const options = ((after as { settings: { options?: { id: string }[] } })
        .settings.options ?? []) as { id: string }[];
      expect(options.some((o) => o.id === "opt-1")).toBe(false);

      // The referencing cell row was deleted.
      const { data: cells } = await owner.anon
        .from("cell_values")
        .select("item_id")
        .eq("column_id", columnId);
      expect(cells ?? []).toHaveLength(0);
    });

    it("a non-member cannot remove an option on another org's column", async () => {
      const { data: col } = await owner.anon
        .from("columns")
        .insert({
          org_id: owner.orgId,
          board_id: owner.boardId,
          kind: "status",
          name: "Status 2",
          settings: {
            options: [{ id: "opt-x", label: "X", color: "#fff000" }],
          },
          position: 100,
        })
        .select("id")
        .single();
      const columnId = (col as { id: string }).id;

      // The outsider's RPC sees no such column (RLS) → cleared 0, option intact.
      const { data: cleared } = await outsider.anon.rpc(
        "delete_column_option",
        { p_column_id: columnId, p_option_id: "opt-x" },
      );
      expect(cleared ?? 0).toBe(0);

      const { data: after } = await owner.anon
        .from("columns")
        .select("settings")
        .eq("id", columnId)
        .single();
      const options = ((after as { settings: { options?: { id: string }[] } })
        .settings.options ?? []) as { id: string }[];
      expect(options.some((o) => o.id === "opt-x")).toBe(true);
    });
  },
);
