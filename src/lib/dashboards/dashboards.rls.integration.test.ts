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
  statusColumnId: string;
  doneOptionId: string;
  dashboardId: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!SERVICE_ROLE_KEY)(
  "RLS: dashboards tenant isolation + aggregate",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let userA: TestUser;
    let userB: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-dash-${randomUUID()}@example.com`;
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
        p_slug: `rls-d-${label}-${randomUUID().slice(0, 8)}`,
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

      // Grab the seeded Status column + its "Done" option.
      const { data: statusCol } = await anon
        .from("columns")
        .select("id, settings")
        .eq("board_id", boardId)
        .eq("kind", "status")
        .single();
      const statusColumnId = (statusCol as { id: string }).id;
      const options = (
        statusCol as unknown as {
          settings: { options: { id: string; label: string }[] };
        }
      ).settings.options;
      const doneOptionId = options.find((o) => o.label === "Done")!.id;

      const { data: dash, error: dashErr } = await anon.rpc(
        "create_dashboard",
        {
          p_workspace_id: workspaceId,
          p_name: `Dash ${label}`,
        },
      );
      expect(dashErr, `create_dashboard(${label})`).toBeNull();
      const dashboardId = (dash as { id: string }).id;

      return {
        id,
        orgId,
        workspaceId,
        boardId,
        statusColumnId,
        doneOptionId,
        dashboardId,
        anon,
      };
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

    it("dashboard_aggregate count returns the item total", async () => {
      // Add 3 items to A's board.
      const { data: group } = await userA.anon
        .from("groups")
        .select("id")
        .eq("board_id", userA.boardId)
        .single();
      const groupId = (group as { id: string }).id;

      for (let i = 0; i < 3; i++) {
        await userA.anon.rpc("create_item", {
          p_group_id: groupId,
          p_name: `Item ${i}`,
        });
      }

      const { data, error } = await userA.anon.rpc("dashboard_aggregate", {
        p_board_id: userA.boardId,
        p_agg: "count",
      });
      expect(error).toBeNull();
      expect(Number(data![0].metric)).toBe(3);
      expect(data![0].group_key).toBeNull();
    });

    it("denies aggregating another org's board", async () => {
      const { error } = await userB.anon.rpc("dashboard_aggregate", {
        p_board_id: userA.boardId,
        p_agg: "count",
      });
      expect(error).not.toBeNull(); // 42501 not a member
    });

    it("denies reading another org's dashboard rows", async () => {
      const { data } = await userB.anon
        .from("dashboards")
        .select("*")
        .eq("id", userA.dashboardId);
      expect(data).toEqual([]);
    });

    it("create_dashboard_widget rejects a source board from another org", async () => {
      const { error } = await userB.anon.rpc("create_dashboard_widget", {
        p_dashboard_id: userB.dashboardId,
        p_kind: "number",
        p_source_board_id: userA.boardId, // cross-org board
        p_title: "",
        p_config: { agg: "count" },
        p_layout: {},
      });
      expect(error).not.toBeNull();
    });
  },
);
