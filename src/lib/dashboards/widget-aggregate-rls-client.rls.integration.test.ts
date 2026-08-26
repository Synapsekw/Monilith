import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import { resolveWidgetSlot } from "@/lib/dashboards/widget-slot-core";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

// Regression for the confirmed live bug (since 20260704110000): number/
// battery/completion/health dashboard widgets resolved through
// `getWidgetAggregationCached`/`getWidgetCompletionCached`/
// `getWidgetHealthCached` (queries-cached.ts), which ran `dashboard_aggregate`/
// `dashboard_completion`/`dashboard_health_summary` on `createServiceClient()`
// — a service-role client with no user session. Those RPCs are SECURITY
// DEFINER and gate on `is_org_member(org_id)`, which reads `auth.uid()`. With
// no session, `auth.uid()` is NULL, so the guard raised `42501`
// UNCONDITIONALLY — for every widget of these kinds, every time, even for the
// board's own owner. `dashboard-board-read-guards.rls.integration.test.ts`
// already proves the RPCs themselves work fine given a REAL session (its "the
// owner CAN read its own private board's dashboard aggregate" test); this
// suite proves the APPLICATION path (`resolveWidgetSlot`, the function
// `getWidgetsData`/`getWidgetData` server actions and the MCP `get_widget_data`
// tool both call) now actually uses that real session instead of the
// always-broken service client.
describe.skipIf(!integrationTargetReady())(
  "RLS: resolveWidgetSlot resolves the aggregate family via the caller's own session",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    let owner: {
      id: string;
      orgId: string;
      boardId: string;
      statusColumnId: string;
      doneOptionId: string;
      anon: SupabaseClient<Database>;
    };

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const email = `widget-agg-owner-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, "createUser(owner)").toBeNull();
      const id = created.user!.id;
      createdUserIds.push(id);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });

      const { data: org } = await anon.rpc("create_organization", {
        p_name: "Widget Agg Org",
        p_slug: `widget-agg-${randomUUID().slice(0, 8)}`,
      });
      const orgId = (org as { id: string }).id;

      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;

      const { data: board, error: boardErr } = await anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: "Widget Agg Board",
      });
      expect(boardErr, "create_board").toBeNull();
      const boardId = (board as { id: string }).id;

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

      const { data: group } = await anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      const groupId = (group as { id: string }).id;
      const { data: item } = await anon.rpc("create_item", {
        p_group_id: groupId,
        p_name: "Item",
      });
      const itemId = (item as { id: string }).id;
      await anon.from("cell_values").upsert({
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        column_id: statusColumnId,
        value: { optionId: doneOptionId },
      });

      owner = { id, orgId, boardId, statusColumnId, doneOptionId, anon };
    }, 90_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("number: resolveWidgetSlot succeeds for the board's own owner (was 42501 unconditionally)", async () => {
      const result = await resolveWidgetSlot(owner.anon, randomUUID(), {
        kind: "number",
        config: { agg: "count" },
        source_board_id: owner.boardId,
        org_id: owner.orgId,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok && "buckets" in result)
        expect(result.buckets.length).toBeGreaterThan(0);
    });

    it("completion: resolveWidgetSlot succeeds for the board's own owner", async () => {
      const result = await resolveWidgetSlot(owner.anon, randomUUID(), {
        kind: "completion",
        config: {
          mode: "status",
          statusColumnId: owner.statusColumnId,
          doneOptionIds: [owner.doneOptionId],
        },
        source_board_id: owner.boardId,
        org_id: owner.orgId,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok && "completion" in result)
        expect(result.completion?.rows.length).toBeGreaterThan(0);
    });

    it("health: resolveWidgetSlot succeeds for the board's own owner", async () => {
      const result = await resolveWidgetSlot(owner.anon, randomUUID(), {
        kind: "health",
        config: {},
        source_board_id: owner.boardId,
        org_id: owner.orgId,
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok && "health" in result)
        expect(result.health?.totalItems).toBeGreaterThan(0);
    });
  },
);
