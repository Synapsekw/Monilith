import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database, Json } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

// Date horizon for the workload rollup, and a single seed date inside it so
// every seeded item overlaps the window (mirrors workload.rls.integration).
const FROM = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
const TO = new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10);
const SEED_DATE = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

type Mode = Database["public"]["Enums"]["goal_progress_mode"];
type Status = Database["public"]["Enums"]["goal_status"];

/** create_goal takes 13 named args; fill the optionals with null. */
function createGoalArgs(name: string, mode: Mode) {
  return {
    p_name: name,
    p_progress_mode: mode,
    p_owner_id: null as unknown as string,
    p_parent_goal_id: null as unknown as string,
    p_workspace_id: null as unknown as string,
    p_status: null as unknown as Status,
    p_start_value: null as unknown as number,
    p_current_value: null as unknown as number,
    p_target_value: null as unknown as number,
    p_unit: null as unknown as string,
    p_percent: null as unknown as number,
    p_start_date: null as unknown as string,
    p_due_date: null as unknown as string,
  };
}

// No-archived-leakage sweep: every aggregation RPC must count ONLY live items.
// The board is seeded with 3 live + 2 archived top-level items across statuses,
// each dated + assigned so the workload/health/rollup RPCs would surface them if
// they leaked. Expected everywhere: 3 total items, 2 of them "done".
describe.skipIf(!integrationTargetReady())(
  "archived-aggregates: aggregation RPCs exclude archived items",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    let member: SupabaseClient<Database>;
    let memberUserId: string;
    let orgId: string;
    let boardId: string;
    let groupId: string;
    let statusColId: string;
    let dateColId: string;
    let peopleColId: string;
    let doneOptId: string;
    let wipOptId: string;
    let portfolioId: string;
    let goalId: string;

    const liveItemIds: string[] = [];
    const archivedItemIds: string[] = [];

    async function provision(label: string) {
      const email = `arch-agg-${label}-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, `createUser(${label})`).toBeNull();
      const userId = created.user!.id;
      createdUserIds.push(userId);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
      return { anon, userId };
    }

    // Create an item + its status / date / people cells.
    async function seedItem(opts: {
      name: string;
      statusOptionId: string;
    }): Promise<string> {
      const { data: item, error } = await member.rpc("create_item", {
        p_group_id: groupId,
        p_name: opts.name,
      });
      expect(error, `create_item(${opts.name})`).toBeNull();
      const itemId = (item as { id: string }).id;

      const cells: { column_id: string; value: Json }[] = [
        { column_id: statusColId, value: { optionId: opts.statusOptionId } },
        { column_id: dateColId, value: { date: SEED_DATE } },
        { column_id: peopleColId, value: { userIds: [memberUserId] } },
      ];
      for (const c of cells) {
        const { error: cellErr } = await member.from("cell_values").upsert({
          org_id: orgId,
          board_id: boardId,
          item_id: itemId,
          column_id: c.column_id,
          value: c.value,
        });
        expect(cellErr, `cell ${c.column_id} (${opts.name})`).toBeNull();
      }
      return itemId;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const m = await provision("member");
      member = m.anon;
      memberUserId = m.userId;

      const { data: org, error: orgErr } = await member.rpc(
        "create_organization",
        {
          p_name: "Arch Agg Org",
          p_slug: `arch-agg-${randomUUID().slice(0, 8)}`,
        },
      );
      expect(orgErr, "create_organization").toBeNull();
      orgId = (org as { id: string }).id;

      const { data: ws, error: wsErr } = await member
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: m.userId })
        .select("id")
        .single();
      expect(wsErr, "insert workspace").toBeNull();

      const { data: board, error: boardErr } = await member.rpc(
        "create_board",
        {
          p_workspace_id: (ws as { id: string }).id,
          p_name: "Aggregates",
        },
      );
      expect(boardErr, "create_board").toBeNull();
      boardId = (board as { id: string }).id;

      const { data: group } = await member
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      groupId = (group as { id: string }).id;

      // create_board seeds Status + Owner (people) + Date columns.
      const { data: cols, error: colsErr } = await member
        .from("columns")
        .select("id, kind, settings")
        .eq("board_id", boardId);
      expect(colsErr, "read columns").toBeNull();
      const statusCol = (cols ?? []).find((c) => c.kind === "status")!;
      statusColId = statusCol.id;
      dateColId = (cols ?? []).find((c) => c.kind === "date")!.id;
      peopleColId = (cols ?? []).find((c) => c.kind === "people")!.id;
      const options = (
        statusCol as unknown as {
          settings: { options: { id: string; label: string }[] };
        }
      ).settings.options;
      doneOptId = options.find((o) => o.label === "Done")!.id;
      wipOptId = options.find((o) => o.label !== "Done")!.id;

      // 3 live (2 done, 1 wip) + 2 archived (1 done, 1 wip).
      liveItemIds.push(
        await seedItem({ name: "live-done-1", statusOptionId: doneOptId }),
      );
      liveItemIds.push(
        await seedItem({ name: "live-done-2", statusOptionId: doneOptId }),
      );
      liveItemIds.push(
        await seedItem({ name: "live-wip-1", statusOptionId: wipOptId }),
      );
      archivedItemIds.push(
        await seedItem({ name: "arch-done", statusOptionId: doneOptId }),
      );
      archivedItemIds.push(
        await seedItem({ name: "arch-wip", statusOptionId: wipOptId }),
      );

      for (const id of archivedItemIds) {
        const { error: archErr } = await member.rpc("archive_item", {
          p_item_id: id,
        });
        expect(archErr, `archive_item(${id})`).toBeNull();
      }

      // Portfolio linking the board (done = status Done option).
      const { data: pf, error: pfErr } = await member.rpc("create_portfolio", {
        p_name: "PF",
      });
      expect(pfErr, "create_portfolio").toBeNull();
      portfolioId = (pf as { id: string }).id;
      const { error: addErr } = await member.rpc("add_portfolio_board", {
        p_portfolio_id: portfolioId,
        p_board_id: boardId,
        p_done_column_id: statusColId,
        p_done_option_ids: [doneOptId] as unknown as Json,
      });
      expect(addErr, "add_portfolio_board").toBeNull();

      // Auto-boards goal linking the same board (done = status Done option).
      const { data: goal, error: goalErr } = await member.rpc(
        "create_goal",
        createGoalArgs("Ship it", "auto_boards"),
      );
      expect(goalErr, "create_goal").toBeNull();
      goalId = (goal as { id: string }).id;
      const { error: linkErr } = await member.rpc("set_goal_links", {
        p_goal_id: goalId,
        p_links: [
          {
            board_id: boardId,
            done_column_id: statusColId,
            done_option_ids: [doneOptId],
          },
        ] as unknown as Json,
      });
      expect(linkErr, "set_goal_links").toBeNull();
    }, 180_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("dashboard_aggregate (count) counts only the 3 live items", async () => {
      const { data, error } = await member.rpc("dashboard_aggregate", {
        p_board_id: boardId,
        p_agg: "count",
      });
      expect(error).toBeNull();
      expect(Number(data![0].metric)).toBe(3);
    });

    it("dashboard_completion counts only the 3 live items in the group", async () => {
      const { data, error } = await member.rpc("dashboard_completion", {
        p_board_id: boardId,
        p_mode: "status",
        p_value_column_id: statusColId,
        p_done_option_ids: [doneOptId] as unknown as Json,
      });
      expect(error).toBeNull();
      const row = (data ?? []).find((r) => r.group_key === groupId);
      expect(row?.item_count).toBe(3);
    });

    it("dashboard_health_summary (_board_health_counts) totals only the 3 live items", async () => {
      const { data, error } = await member.rpc("dashboard_health_summary", {
        p_board_id: boardId,
      });
      expect(error).toBeNull();
      expect(data?.[0]?.total_items).toBe(3);
      expect(data?.[0]?.done_items).toBe(2);
    });

    it("workload_rollup surfaces the 3 live items and none of the archived", async () => {
      const { data, error } = await member.rpc("workload_rollup", {
        p_from: FROM,
        p_to: TO,
      });
      expect(error).toBeNull();
      const rollupIds = new Set((data ?? []).map((r) => r.item_id));
      for (const id of liveItemIds) expect(rollupIds.has(id)).toBe(true);
      for (const id of archivedItemIds) expect(rollupIds.has(id)).toBe(false);
    });

    it("goals_rollup counts only the 3 live items (2 done)", async () => {
      const { data, error } = await member.rpc("goals_rollup");
      expect(error).toBeNull();
      const row = (data ?? []).find(
        (r) => r.goal_id === goalId && r.board_id === boardId,
      );
      expect(Number(row?.total_items)).toBe(3);
      expect(Number(row?.done_items)).toBe(2);
    });

    it("portfolio_rollup counts only the 3 live items (2 done)", async () => {
      const { data, error } = await member.rpc("portfolio_rollup", {
        p_portfolio_id: portfolioId,
        p_today: TODAY,
      });
      expect(error).toBeNull();
      const row = (data ?? []).find((r) => r.board_id === boardId);
      expect(Number(row?.total_items)).toBe(3);
      expect(Number(row?.done_items)).toBe(2);
    });
  },
);
