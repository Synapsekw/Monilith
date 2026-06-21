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
      await signInWithRetry(anon, { email, password: PASSWORD });

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

    it("dashboard_aggregate groups items by a status column (optionId + None bucket)", async () => {
      // userA's board already has 3 items from the earlier count test; set "Done" on one item.
      const { data: items } = await userA.anon
        .from("items")
        .select("id")
        .eq("board_id", userA.boardId);
      expect(items && items.length > 0).toBe(true);
      // set the status cell on the first item via direct cell_values upsert (mirrors boards RLS test)
      await userA.anon.from("cell_values").upsert({
        org_id: userA.orgId,
        board_id: userA.boardId,
        item_id: items![0].id,
        column_id: userA.statusColumnId,
        value: { optionId: userA.doneOptionId },
      });

      const { data, error } = await userA.anon.rpc("dashboard_aggregate", {
        p_board_id: userA.boardId,
        p_group_column_id: userA.statusColumnId,
        p_agg: "count",
      });
      expect(error).toBeNull();
      const done = data!.find((r) => r.group_key === userA.doneOptionId);
      const none = data!.find((r) => r.group_key === null);
      expect(Number(done!.metric)).toBe(1);
      expect(Number(none!.metric)).toBeGreaterThanOrEqual(1); // the other items
    });

    // Seed an item on a board, optionally giving it a status cell.
    async function seedItem(
      user: TestUser,
      opts: { name: string; statusOptionId?: string | null },
    ) {
      const { data: item } = await user.anon
        .from("items")
        .insert({
          board_id: user.boardId,
          org_id: user.orgId,
          group_id: (
            await user.anon
              .from("groups")
              .select("id")
              .eq("board_id", user.boardId)
              .single()
          ).data!.id,
          name: opts.name,
        })
        .select("id")
        .single();
      const itemId = (item as { id: string }).id;
      if (opts.statusOptionId !== undefined && opts.statusOptionId !== null) {
        await user.anon.from("cell_values").insert({
          item_id: itemId,
          column_id: user.statusColumnId,
          board_id: user.boardId,
          org_id: user.orgId,
          value: { optionId: opts.statusOptionId },
        });
      }
      return itemId;
    }

    describe("dashboard_list_rows (D3b filter)", () => {
      it("filters by status 'is' and includes the empty-status item only via is_empty", async () => {
        await seedItem(userA, {
          name: "Done one",
          statusOptionId: userA.doneOptionId,
        });
        await seedItem(userA, { name: "No status", statusOptionId: null });

        const isDone = await userA.anon.rpc("dashboard_list_rows", {
          p_board_id: userA.boardId,
          p_filter: {
            combinator: "and",
            conditions: [
              {
                columnId: userA.statusColumnId,
                operator: "is",
                value: userA.doneOptionId,
              },
            ],
          },
          p_limit: 50,
        });
        expect(isDone.error).toBeNull();
        const doneNames = (isDone.data ?? []).map((r) => r.name);
        expect(doneNames).toContain("Done one");
        expect(doneNames).not.toContain("No status");

        const empties = await userA.anon.rpc("dashboard_list_rows", {
          p_board_id: userA.boardId,
          p_filter: {
            conditions: [
              { columnId: userA.statusColumnId, operator: "is_empty" },
            ],
          },
          p_limit: 50,
        });
        expect(empties.error).toBeNull();
        const emptyNames = (empties.data ?? []).map((r) => r.name);
        expect(emptyNames).toContain("No status");
        expect(emptyNames).not.toContain("Done one");
      });

      it("applies the limit AFTER filtering (newest first)", async () => {
        for (const n of ["A", "B", "C"])
          await seedItem(userA, {
            name: `lim-${n}`,
            statusOptionId: userA.doneOptionId,
          });
        const res = await userA.anon.rpc("dashboard_list_rows", {
          p_board_id: userA.boardId,
          p_filter: {
            conditions: [
              {
                columnId: userA.statusColumnId,
                operator: "is",
                value: userA.doneOptionId,
              },
            ],
          },
          p_limit: 2,
        });
        expect(res.error).toBeNull();
        expect((res.data ?? []).length).toBe(2);
      });

      it("empty filter returns latest-N of the board (D3a parity)", async () => {
        const res = await userA.anon.rpc("dashboard_list_rows", {
          p_board_id: userA.boardId,
          p_filter: {},
          p_limit: 5,
        });
        expect(res.error).toBeNull();
        expect((res.data ?? []).length).toBeGreaterThan(0);
      });

      it("denies running against another org's board (42501)", async () => {
        const res = await userB.anon.rpc("dashboard_list_rows", {
          p_board_id: userA.boardId,
          p_filter: {},
          p_limit: 10,
        });
        expect(res.error).not.toBeNull();
        expect(res.error?.code).toBe("42501");
      });
    });
  },
);
