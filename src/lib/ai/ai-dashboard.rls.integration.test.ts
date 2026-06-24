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
  anon: SupabaseClient<Database>;
};

describe.skipIf(!SERVICE_ROLE_KEY)(
  "RLS: ai-dashboard snapshot reads and create-from-proposal tenant isolation",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let userA: TestUser;
    let userB: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-ai-dash-${randomUUID()}@example.com`;
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
        p_name: `rls-ai-org-${label}`,
        p_slug: `rls-ai-${label}-${randomUUID().slice(0, 8)}`,
      });
      const orgId = (org as { id: string }).id;

      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: `rls-ai-ws-${label}`, created_by: id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;

      const { data: board, error: boardErr } = await anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: `rls-ai-board-${label}`,
      });
      expect(boardErr, `create_board(${label})`).toBeNull();
      const boardId = (board as { id: string }).id;

      // Grab the auto-seeded Status column.
      const { data: statusCol } = await anon
        .from("columns")
        .select("id, settings")
        .eq("board_id", boardId)
        .eq("kind", "status")
        .single();
      const statusColumnId = (statusCol as { id: string }).id;

      // Seed one item so the board has data for snapshot reads.
      const { data: group } = await anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      const groupId = (group as { id: string }).id;

      const { data: item } = await anon
        .from("items")
        .insert({
          board_id: boardId,
          org_id: orgId,
          group_id: groupId,
          name: `rls-ai-item-${label}`,
        })
        .select("id")
        .single();
      const itemId = (item as { id: string }).id;

      // Set a status cell on the item so cell_values has a row.
      const options = (
        statusCol as unknown as {
          settings: { options: { id: string; label: string }[] };
        }
      ).settings.options;
      const firstOptionId = options[0]?.id;
      if (firstOptionId) {
        await anon.from("cell_values").insert({
          item_id: itemId,
          column_id: statusColumnId,
          board_id: boardId,
          org_id: orgId,
          value: { optionId: firstOptionId },
        });
      }

      return { id, orgId, workspaceId, boardId, statusColumnId, anon };
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      userA = await provisionUser("a");
      userB = await provisionUser("b");
    }, 60_000);

    afterAll(async () => {
      // Delete all fixture users — cascades to orgs, workspaces, boards, columns,
      // items, cell_values, dashboards, and dashboard_widgets via FK cascades.
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    }, 60_000);

    // -------------------------------------------------------------------------
    // Step 2: Snapshot read isolation (columns / items / cell_values)
    // -------------------------------------------------------------------------

    it("user A can read their own board's columns (snapshot input)", async () => {
      const { data, error } = await userA.anon
        .from("columns")
        .select("id")
        .eq("board_id", userA.boardId);
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    });

    it("user A cannot read board B's columns (cross-tenant RLS → empty)", async () => {
      const { data, error } = await userA.anon
        .from("columns")
        .select("id")
        .eq("board_id", userB.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("user A can read their own board's items (snapshot input)", async () => {
      const { data, error } = await userA.anon
        .from("items")
        .select("id")
        .eq("board_id", userA.boardId);
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    });

    it("user A cannot read board B's items (cross-tenant RLS → empty)", async () => {
      const { data, error } = await userA.anon
        .from("items")
        .select("id")
        .eq("board_id", userB.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("user A can read their own board's cell_values (snapshot input)", async () => {
      const { data, error } = await userA.anon
        .from("cell_values")
        .select("item_id")
        .eq("board_id", userA.boardId);
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    });

    it("user A cannot read board B's cell_values (cross-tenant RLS → empty)", async () => {
      const { data, error } = await userA.anon
        .from("cell_values")
        .select("item_id")
        .eq("board_id", userB.boardId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // Step 3: create_dashboard + create_dashboard_widget (happy path, own org)
    // -------------------------------------------------------------------------

    it("user A can create a dashboard in their workspace", async () => {
      const { data, error } = await userA.anon.rpc("create_dashboard", {
        p_workspace_id: userA.workspaceId,
        p_name: "rls-ai-test-dashboard",
      });
      expect(error).toBeNull();
      expect((data as { id: string }).id).toBeTruthy();

      // The created dashboard must be visible to user A (org-scoped).
      const newDashId = (data as { id: string }).id;
      const { data: visible } = await userA.anon
        .from("dashboards")
        .select("id")
        .eq("id", newDashId);
      expect(visible).not.toEqual([]);

      // And must NOT be visible to user B (cross-tenant isolation).
      const { data: hidden } = await userB.anon
        .from("dashboards")
        .select("id")
        .eq("id", newDashId);
      expect(hidden).toEqual([]);
    });

    it("user A can create a widget pointing at their own board (happy path)", async () => {
      // Create a fresh dashboard for widget creation.
      const { data: dash, error: dashErr } = await userA.anon.rpc(
        "create_dashboard",
        {
          p_workspace_id: userA.workspaceId,
          p_name: "rls-ai-widget-dashboard",
        },
      );
      expect(dashErr).toBeNull();
      const dashId = (dash as { id: string }).id;

      const { data: widget, error: widgetErr } = await userA.anon.rpc(
        "create_dashboard_widget",
        {
          p_dashboard_id: dashId,
          p_kind: "number",
          p_source_board_id: userA.boardId,
          p_title: "rls-ai-test-widget",
          p_config: { agg: "count" },
          p_layout: { x: 0, y: 0, w: 3, h: 2 },
        },
      );
      expect(widgetErr).toBeNull();
      expect((widget as { id: string }).id).toBeTruthy();
    });

    // -------------------------------------------------------------------------
    // Step 4: cross-tenant widget creation must be rejected or invisible
    // -------------------------------------------------------------------------

    it("user A cannot create a widget with p_source_board_id from tenant B (denied or not visible)", async () => {
      // First, A creates their own dashboard to attempt the cross-tenant widget on.
      const { data: dash } = await userA.anon.rpc("create_dashboard", {
        p_workspace_id: userA.workspaceId,
        p_name: "rls-ai-cross-tenant-test",
      });
      const dashId = (dash as { id: string }).id;

      const { data: widget, error } = await userA.anon.rpc(
        "create_dashboard_widget",
        {
          p_dashboard_id: dashId,
          p_kind: "number",
          p_source_board_id: userB.boardId, // cross-tenant board
          p_title: "rls-ai-cross-tenant-widget",
          p_config: { agg: "count" },
          p_layout: { x: 0, y: 0, w: 3, h: 2 },
        },
      );

      // RLS must either reject the call outright (error) OR insert a row that A
      // cannot subsequently read (the widget references a board A can't see).
      if (error) {
        // Preferred: RLS denies the insert.
        expect(error).not.toBeNull();
      } else {
        // Fallback: insert succeeded (e.g. source_board_id is not RLS-gated at
        // insert time) but the widget row must not expose board B's data.
        // We verify by checking the widget is not accessible to user B (who owns
        // board B) under A's dashboard, and that user A cannot aggregate board B.
        const widgetId = (widget as { id: string } | null)?.id;
        if (widgetId) {
          // B must not see A's dashboard widget.
          const { data: bSees } = await userB.anon
            .from("dashboard_widgets")
            .select("id")
            .eq("id", widgetId);
          expect(bSees).toEqual([]);
        }
        // A must not be able to aggregate board B's data.
        const { error: aggErr } = await userA.anon.rpc("dashboard_aggregate", {
          p_board_id: userB.boardId,
          p_agg: "count",
        });
        expect(aggErr).not.toBeNull();
      }
    });
  },
);
