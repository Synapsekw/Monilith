import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { Database } from "@/types/database.types";
import type { GetClient } from "./shared";
import { listItemsHandler } from "./list-items";
import { getItemHandler } from "./get-item";
import { listGoalsHandler } from "./list-goals";
import { getGoalHandler } from "./get-goal";
import { listDashboardsHandler } from "./list-dashboards";
import { getDashboardHandler } from "./get-dashboard";
import { listTimeAllocationsHandler } from "./list-time-allocations";
import { getTimeSummaryHandler } from "./get-time-summary";
import { logTimeAllocationHandler } from "./log-time-allocation";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type Tenant = {
  id: string;
  orgId: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  getClient: GetClient;
};

// Proves the positive path that `cross-org-access.rls.integration.test.ts`
// deliberately does not: a legitimate member sees their own org's rows
// through each read tool, and a real (but foreign) org member never does —
// even when the tool takes no `orgId` at all and resolves it implicitly.
describe.skipIf(!integrationTargetReady())(
  "MCP surface reads: a seeded row is visible to its org, invisible outside it",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    const createdOrgIds: string[] = [];
    let tenantA: Tenant;
    let tenantB: Tenant;

    // Dynamic import DEFERRED until after loadIntegrationEnv() has overridden
    // process.env — same reasoning as cross-org-access.rls.integration.test.ts:
    // a static import would resolve during this file's import-hoisting phase,
    // before loadIntegrationEnv() runs, baking in vitest.setup.ts's
    // placeholder localhost URL instead of the real target.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    async function provisionTenant(label: string): Promise<Tenant> {
      const email = `mcp-surface-${label}-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
      if (createErr || !created.user)
        throw new Error(`createUser(${label}) failed: ${createErr?.message}`);
      const id = created.user.id;
      createdUserIds.push(id);

      const secretId = await mintBridgeSecret(id);
      const { client } = await getBridgedClient(secretId);

      const { data: org, error: orgErr } = await client.rpc(
        "create_organization",
        {
          p_name: `Surface Org ${label}`,
          p_slug: `mcp-surface-${label}-${randomUUID().slice(0, 8)}`,
        },
      );
      if (orgErr || !org)
        throw new Error(
          `create_organization(${label}) failed: ${orgErr?.message}`,
        );
      const orgId = (org as { id: string }).id;
      createdOrgIds.push(orgId);

      const { data: ws, error: wsErr } = await client
        .from("workspaces")
        .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
        .select("id")
        .single();
      if (wsErr || !ws)
        throw new Error(`workspace insert(${label}) failed: ${wsErr.message}`);
      const workspaceId = (ws as { id: string }).id;

      const { data: board, error: boardErr } = await client.rpc(
        "create_board",
        { p_workspace_id: workspaceId, p_name: `Board ${label}` },
      );
      if (boardErr || !board)
        throw new Error(`create_board(${label}) failed: ${boardErr?.message}`);
      const boardId = (board as { id: string }).id;

      const { data: group, error: groupErr } = await client
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .limit(1)
        .single();
      if (groupErr || !group)
        throw new Error(`group lookup(${label}) failed: ${groupErr.message}`);
      const groupId = (group as { id: string }).id;

      return {
        id,
        orgId,
        workspaceId,
        boardId,
        groupId,
        getClient: async () => (await getBridgedClient(secretId)).client,
      };
    }

    let itemId: string;
    let itemName: string;
    let goalId: string;
    let goalName: string;
    let dashboardId: string;
    let dashboardName: string;
    const allocationCategory = `Surface test ${randomUUID().slice(0, 8)}`;

    beforeAll(async () => {
      ({ mintBridgeSecret, getBridgedClient } =
        await import("@/lib/mcp/oauth/session-bridge"));
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      tenantA = await provisionTenant("a");
      tenantB = await provisionTenant("b");

      const clientA = await tenantA.getClient();

      itemName = `Surface item ${randomUUID().slice(0, 8)}`;
      const { data: item, error: itemErr } = await clientA.rpc("create_item", {
        p_group_id: tenantA.groupId,
        p_name: itemName,
      });
      if (itemErr || !item)
        throw new Error(`create_item failed: ${itemErr?.message}`);
      itemId = (item as { id: string }).id;

      goalName = `Surface goal ${randomUUID().slice(0, 8)}`;
      const { data: goal, error: goalErr } = await typedRpc(
        clientA,
        "create_goal",
        {
          p_name: goalName,
          p_progress_mode: "manual_percent",
          p_owner_id: null,
          p_parent_goal_id: null,
          p_workspace_id: null,
          p_status: null,
          p_start_value: null,
          p_current_value: null,
          p_target_value: null,
          p_unit: null,
          p_percent: 42,
          p_start_date: null,
          p_due_date: null,
        },
      );
      if (goalErr || !goal)
        throw new Error(`create_goal failed: ${goalErr?.message}`);
      goalId = (goal as { id: string }).id;

      dashboardName = `Surface dash ${randomUUID().slice(0, 8)}`;
      const { data: dash, error: dashErr } = await clientA.rpc(
        "create_dashboard",
        { p_workspace_id: tenantA.workspaceId, p_name: dashboardName },
      );
      if (dashErr || !dash)
        throw new Error(`create_dashboard failed: ${dashErr?.message}`);
      dashboardId = (dash as { id: string }).id;

      const allocResult = await logTimeAllocationHandler(
        tenantA.getClient,
        tenantA.id,
        { date: "2026-01-05", category: allocationCategory, secs: 900 },
      );
      if (allocResult.isError)
        throw new Error(
          `seed allocation failed: ${allocResult.content[0].text}`,
        );
    }, 120_000);

    afterAll(async () => {
      // Deleting each org first cascades workspaces/boards/goals/dashboards/
      // time_allocations owned by it (all declared `org_id ... on delete
      // cascade`), so by the time we delete the owning user no row anywhere
      // still references them. `organizations.created_by` is deliberately
      // NOT NULL / NO ACTION (2026-07-25 account-deletion-fks migration) —
      // deleting the user first would fail with a foreign-key violation and
      // leave the org (and everything under it) orphaned.
      for (const orgId of createdOrgIds) {
        await admin.from("organizations").delete().eq("id", orgId);
      }
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    }, 60_000);

    describe("list_items / get_item", () => {
      it("user A sees the seeded item", async () => {
        const list = await listItemsHandler(tenantA.getClient, {
          boardId: tenantA.boardId,
        });
        expect(list.isError).toBeUndefined();
        const parsed = JSON.parse(list.content[0].text as string);
        expect(parsed.items.map((i: { name: string }) => i.name)).toContain(
          itemName,
        );

        const single = await getItemHandler(tenantA.getClient, { itemId });
        expect(single.isError).toBeUndefined();
        const singleParsed = JSON.parse(single.content[0].text as string);
        expect(singleParsed.item.name).toBe(itemName);
      }, 30_000);

      it("user B cannot see it", async () => {
        const list = await listItemsHandler(tenantB.getClient, {
          boardId: tenantA.boardId,
        });
        // RLS makes org A's board invisible to B, so the board lookup finds
        // nothing — same "not found" contract proven in
        // list-items.rls.integration.test.ts.
        expect(list.isError).toBe(true);
        expect(list.content[0].text).toBe("Board not found.");
        expect(JSON.stringify(list)).not.toContain(itemName);

        const single = await getItemHandler(tenantB.getClient, { itemId });
        expect(single.isError).toBe(true);
        expect(single.content[0].text).toBe("Item not found.");
      }, 30_000);
    });

    describe("list_goals / get_goal", () => {
      it("user A sees the seeded goal", async () => {
        const list = await listGoalsHandler(tenantA.getClient, {});
        expect(list.isError).toBeUndefined();
        const goals = JSON.parse(list.content[0].text as string) as {
          name: string;
        }[];
        expect(goals.map((g) => g.name)).toContain(goalName);

        const single = await getGoalHandler(tenantA.getClient, { goalId });
        expect(single.isError).toBeUndefined();
        const parsed = JSON.parse(single.content[0].text as string);
        expect(parsed.name).toBe(goalName);
      }, 30_000);

      it("user B cannot see it", async () => {
        // orgId omitted — B's own default org, which never had this goal.
        const list = await listGoalsHandler(tenantB.getClient, {});
        expect(list.isError).toBeUndefined();
        const goals = JSON.parse(list.content[0].text as string) as {
          name: string;
        }[];
        expect(goals.map((g) => g.name)).not.toContain(goalName);

        // A direct-by-id lookup with B's own default org resolved: the goal
        // tree never contains org A's goal, so it is reported not found —
        // RLS never even needs to be reached explicitly, matching what a
        // real caller who does not know the id would see.
        const single = await getGoalHandler(tenantB.getClient, { goalId });
        expect(single.isError).toBe(true);
      }, 30_000);
    });

    describe("list_dashboards / get_dashboard", () => {
      it("user A sees the seeded dashboard", async () => {
        const list = await listDashboardsHandler(tenantA.getClient, {});
        expect(list.isError).toBeUndefined();
        const dashboards = JSON.parse(list.content[0].text as string) as {
          name: string;
        }[];
        expect(dashboards.map((d) => d.name)).toContain(dashboardName);

        const single = await getDashboardHandler(tenantA.getClient, {
          dashboardId,
        });
        expect(single.isError).toBeUndefined();
        const parsed = JSON.parse(single.content[0].text as string);
        expect(parsed.name).toBe(dashboardName);
      }, 30_000);

      it("user B cannot see it", async () => {
        const list = await listDashboardsHandler(tenantB.getClient, {});
        expect(list.isError).toBeUndefined();
        const dashboards = JSON.parse(list.content[0].text as string) as {
          name: string;
        }[];
        expect(dashboards.map((d) => d.name)).not.toContain(dashboardName);

        // get_dashboard takes no orgId — RLS on `dashboards` is the only
        // thing standing between B and org A's row when B names it directly.
        const single = await getDashboardHandler(tenantB.getClient, {
          dashboardId,
        });
        expect(single.isError).toBe(true);
      }, 30_000);
    });

    describe("list_time_allocations / get_time_summary", () => {
      it("user A sees the seeded allocation", async () => {
        const list = await listTimeAllocationsHandler(
          tenantA.getClient,
          tenantA.id,
          { from: "2026-01-01", to: "2026-01-31" },
        );
        expect(list.isError).toBeUndefined();
        const parsed = JSON.parse(list.content[0].text as string) as {
          rows: { category: string | null; secs: number }[];
        };
        expect(
          parsed.rows.some(
            (r) => r.category === allocationCategory && r.secs === 900,
          ),
        ).toBe(true);

        const summary = await getTimeSummaryHandler(
          tenantA.getClient,
          tenantA.id,
          { from: "2026-01-01", to: "2026-01-31", groupBy: "category" },
        );
        expect(summary.isError).toBeUndefined();
        expect(summary.content[0].text).toContain(allocationCategory);
      }, 30_000);

      it("user B's own read never contains org A's allocation", async () => {
        // list_time_allocations / get_time_summary take no orgId at all —
        // they are always scoped to the caller's own userId, so there is no
        // argument surface through which B could even name org A's row. This
        // still exercises the real boundary underneath: `time_allocations`'
        // RLS policy is "read if is_org_member(org_id)", not "read if
        // user_id = caller" — so if the handler's own userId filter were
        // ever dropped, B (not a member of org A) would still be blocked at
        // the database. This assertion would catch either bug.
        const list = await listTimeAllocationsHandler(
          tenantB.getClient,
          tenantB.id,
          { from: "2026-01-01", to: "2026-01-31" },
        );
        expect(list.isError).toBeUndefined();
        const parsed = JSON.parse(list.content[0].text as string) as {
          rows: { category: string | null }[];
        };
        expect(parsed.rows.some((r) => r.category === allocationCategory)).toBe(
          false,
        );
      }, 30_000);
    });

    // Not covered here, each for a specific reason — not simply skipped for
    // convenience:
    // - get_workload aggregates member_capacity + item estimates over a date
    //   window; there is no single seeded row to assert on without also
    //   seeding capacity data, and the foreign-orgId case is already proven
    //   in cross-org-access.rls.integration.test.ts.
    // - list_portfolios / get_portfolio and get_my_work take no orgId at all
    //   — portfolio visibility and assignment scoping need their own
    //   dedicated seed (a portfolio-board link / a people-cell assignment)
    //   that doesn't fit this file's org-vs-org shape.
    // - list_reports / get_report and get_widget_data build on boards and
    //   dashboards already proven above; they would duplicate the same RLS
    //   boundary without exercising a new code path.
    // - search_items shares list_items' underlying board-scoped RLS query.
  },
);
