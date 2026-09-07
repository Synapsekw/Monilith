/**
 * HALF ONE of the end-to-end board-build acceptance test. Its sibling is
 * `board-build-scope.test.ts`, which asserts that a board-scoped agent is
 * refused when it tries to create a board.
 *
 * The pair is split ON PURPOSE, by what each half needs to run:
 *
 *   - This half is genuinely DB-backed. It needs a PROVISIONED test project
 *     (`.env.test` + `PULSE_TEST_DB=1`; DEV and PROD are both deny-listed in
 *     `integration-env.ts` so the destructive teardown can never touch real
 *     user data), so it SKIPS on a normal checkout and its `.integration`
 *     filename correctly keeps it out of `pnpm test`. Run it with
 *     `pnpm test:integration`.
 *   - The sibling needs NO database — its refusal happens in the
 *     `buildAgentTools` wrapper before any query — so it lives in a plain
 *     `.test.ts` and runs in the DEFAULT gate.
 *
 * Same acceptance test, two files, because a skipped assertion guards nothing.
 */
import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";
import type { ToolInvokeContext } from "./descriptor";
import { describeSchemaDescriptor } from "./describe-schema";
import { manageBoardDescriptor } from "./manage-board";
import { manageColumnDescriptor } from "./manage-column";
import { manageGroupDescriptor } from "./manage-group";
import { createItemDescriptor } from "./create-item";
import { manageViewDescriptor } from "./manage-view";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

/**
 * The DB-backed acceptance test for the whole write surface.
 *
 * Gated on `integrationTargetReady()`, which requires a DEDICATED test project
 * (`.env.test` + `PULSE_TEST_DB=1`). DEV and PROD are both deny-listed in
 * `integration-env.ts` on purpose, so this suite SKIPS on a normal checkout
 * rather than building throwaway boards in the live, user-facing database.
 * That skip is the correct default, not a gap: the sibling file named above
 * covers the assertion that needs no database and therefore always runs.
 */
describe.skipIf(!integrationTargetReady())(
  "MCP write surface: a whole board, built from nothing through the tools",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    let ctx: ToolInvokeContext;
    let orgId: string;
    let workspaceId: string;
    let boardId: string;
    const createdGroupIds: string[] = [];

    // Deferred until after loadIntegrationEnv() has overridden process.env —
    // `@/lib/env.ts` caches NEXT_PUBLIC_SUPABASE_URL eagerly at module
    // evaluation, so a static import would bake in vitest.setup.ts's
    // placeholder. Same fix as list-items.rls.integration.test.ts.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    beforeAll(async () => {
      ({ mintBridgeSecret, getBridgedClient } =
        await import("@/lib/mcp/oauth/session-bridge"));
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const email = `mcp-board-build-${randomUUID()}@example.com`;
      const { data: created } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      const userId = created.user!.id;
      createdUserIds.push(userId);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });

      // The ONLY direct writes in this file: the org and workspace a board
      // needs to exist in. Everything from the board down is built through the
      // tool surface, because that is what this test is about.
      const { data: org, error: orgErr } = await anon.rpc(
        "create_organization",
        {
          p_name: "Board-Build Org",
          p_slug: `board-build-${randomUUID().slice(0, 8)}`,
        },
      );
      if (orgErr || !org)
        throw new Error(`create_organization failed: ${orgErr?.message}`);
      orgId = (org as { id: string }).id;

      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "Hiring", created_by: userId })
        .select("id")
        .single();
      workspaceId = (ws as { id: string }).id;

      // The real MCP path: a bridged client authenticated as the user, exactly
      // what an OAuth-connected client gets.
      const secretId = await mintBridgeSecret(userId);
      const { client } = await getBridgedClient(secretId);
      ctx = { getClient: async () => client, actorId: userId };
    }, 120_000);

    /**
     * Removes every object this suite creates, innermost first.
     *
     * It cannot run today — the suite skips without a dedicated test project —
     * but it is written so that whoever DOES point this at one inherits a
     * self-cleaning suite instead of a database that grows a hiring board per
     * run. Deleting the board would cascade to its columns, groups, items and
     * views, but each is removed explicitly so a future schema change that
     * drops a cascade shows up as leftover rows here rather than silently.
     */
    afterAll(async () => {
      if (boardId) {
        if (createdGroupIds.length > 0) {
          await admin.from("items").delete().in("group_id", createdGroupIds);
        }
        await admin.from("board_views").delete().eq("board_id", boardId);
        await admin.from("groups").delete().eq("board_id", boardId);
        await admin.from("columns").delete().eq("board_id", boardId);
        await admin.from("boards").delete().eq("id", boardId);
      }
      if (workspaceId) {
        await admin.from("workspaces").delete().eq("id", workspaceId);
      }
      if (orgId) await admin.from("organizations").delete().eq("id", orgId);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 120_000);

    it("goes from nothing to a populated, viewable board", async () => {
      // 1. Learn the vocabulary. No capability, no database — the model is
      //    meant to call this BEFORE guessing a settings shape.
      const schema = await describeSchemaDescriptor.invoke(ctx, {
        topic: "column_kinds",
      });
      expect(schema.isError).toBeUndefined();
      expect(JSON.parse(schema.content[0]!.text)).toHaveProperty(
        "column_kinds",
      );

      // 2. Create the board.
      const board = await manageBoardDescriptor.invoke(ctx, {
        action: "create",
        workspaceId,
        name: "Hiring Q3",
      });
      expect(board.isError).toBeUndefined();
      boardId = JSON.parse(board.content[0]!.text).boardId;
      expect(boardId).toBeTruthy();

      // 3. Three columns — including a status column with real options — in
      //    ONE call.
      const cols = await manageColumnDescriptor.invoke(ctx, {
        action: "create",
        boardId,
        columns: [
          {
            kind: "status",
            name: "Stage",
            settings: {
              options: [
                { id: "applied", label: "Applied", color: "gray" },
                { id: "hired", label: "Hired", color: "green" },
              ],
            },
          },
          { kind: "date", name: "Start date" },
          { kind: "people", name: "Owner" },
        ],
      });
      expect(cols.isError).toBeUndefined();
      const createdCols = JSON.parse(cols.content[0]!.text);
      expect(createdCols.errors).toEqual([]);
      expect(createdCols.created).toHaveLength(3);
      const stageColumnId: string = createdCols.created[0].id;

      // 4. Two groups in ONE call.
      const groups = await manageGroupDescriptor.invoke(ctx, {
        action: "create",
        boardId,
        groups: [{ name: "Engineering" }, { name: "Design" }],
      });
      expect(groups.isError).toBeUndefined();
      const createdGroups = JSON.parse(groups.content[0]!.text);
      expect(createdGroups.errors).toEqual([]);
      expect(createdGroups.created).toHaveLength(2);
      createdGroupIds.push(
        ...createdGroups.created.map((g: { id: string }) => g.id),
      );
      const groupId: string = createdGroups.created[0].id;

      // 5. Two items in ONE call, one of them setting a field value AS IT IS
      //    created — not a create followed by an update.
      const items = await createItemDescriptor.invoke(ctx, {
        groupId,
        items: [
          {
            name: "Backend engineer",
            fields: [
              { columnId: stageColumnId, value: { optionId: "applied" } },
            ],
          },
          { name: "Platform engineer" },
        ],
      });
      expect(items.isError).toBeUndefined();
      const createdItems = JSON.parse(items.content[0]!.text);
      expect(createdItems.errors).toEqual([]);
      expect(createdItems.created).toHaveLength(2);
      // The field write succeeded too — a created item with a rejected cell
      // value still lands in `created`, so this is the assertion that matters.
      expect(createdItems.created[0].fieldErrors).toEqual([]);

      // 6. A view over it.
      const view = await manageViewDescriptor.invoke(ctx, {
        action: "create",
        boardId,
        kind: "kanban",
        name: "By stage",
      });
      expect(view.isError).toBeUndefined();
      expect(JSON.parse(view.content[0]!.text).viewId).toBeTruthy();

      // SIX tool calls for a whole board — one board, three columns, two
      // groups, two items with a field value, and a view. That number IS the
      // batching design's payoff: without the array forms on manage_column,
      // manage_group and create_item this same board costs eleven round trips,
      // each one a model turn the owner pays for and waits on.
    }, 120_000);

    it("leaves everything recoverable — archive, then restore", async () => {
      const archived = await manageBoardDescriptor.invoke(ctx, {
        action: "archive",
        boardId,
      });
      expect(archived.isError).toBeUndefined();

      const restored = await manageBoardDescriptor.invoke(ctx, {
        action: "restore",
        boardId,
      });
      expect(restored.isError).toBeUndefined();

      // The board is really back, not just "the call returned ok".
      const { data: row } = await admin
        .from("boards")
        .select("archived_at")
        .eq("id", boardId)
        .single();
      expect(row?.archived_at).toBeNull();
    }, 60_000);
  },
);
