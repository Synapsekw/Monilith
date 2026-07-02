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

describe.skipIf(!integrationTargetReady())(
  "RLS + RPC: duplicate_board_structure",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    /** orgA context — userA owns a source board */
    let userAId: string;
    let userAAnon: SupabaseClient<Database>;
    let orgAId: string;
    let boardAId: string;

    /** Number of views create_board auto-seeds (Main Table) */
    const SEEDED_VIEWS = 1;

    /** orgB context — userB is NOT a member of orgA */
    let userBAnon: SupabaseClient<Database>;

    /** userC IS a member of orgA but does NOT own board A and has no share grant */
    let userCAnon: SupabaseClient<Database>;

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // ── userA in orgA ───────────────────────────────────────────────────────
      const emailA = `rls-dupboard-a-${randomUUID()}@example.com`;
      const { data: createdA, error: errA } = await admin.auth.admin.createUser(
        {
          email: emailA,
          password: PASSWORD,
          email_confirm: true,
        },
      );
      expect(errA, "createUser(A)").toBeNull();
      userAId = createdA.user!.id;
      createdUserIds.push(userAId);

      userAAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(userAAnon, { email: emailA, password: PASSWORD });

      const { data: orgData } = await userAAnon.rpc("create_organization", {
        p_name: "Org A (dup-board)",
        p_slug: `dupb-a-${randomUUID().slice(0, 8)}`,
      });
      orgAId = (orgData as { id: string }).id;

      const { data: wsData } = await userAAnon
        .from("workspaces")
        .insert({ org_id: orgAId, name: "WS A", created_by: userAId })
        .select("id")
        .single();
      const wsAId = (wsData as { id: string }).id;

      // create_board auto-seeds: 1 group + 3 columns + 1 view ("Main Table").
      const { data: boardData, error: boardErr } = await userAAnon.rpc(
        "create_board",
        { p_workspace_id: wsAId, p_name: "Source Board" },
      );
      expect(boardErr, "create_board(A)").toBeNull();
      boardAId = (boardData as { id: string }).id;

      // Seed one item carrying a cell value — these must NOT be copied.
      const { data: groupData } = await userAAnon
        .from("groups")
        .select("id")
        .eq("board_id", boardAId)
        .single();
      const groupAId = (groupData as { id: string }).id;

      const { data: itemData } = await userAAnon.rpc("create_item", {
        p_group_id: groupAId,
        p_name: "Item A",
      });
      const itemAId = (itemData as { id: string }).id;

      const { data: colData } = await userAAnon
        .from("columns")
        .select("id")
        .eq("board_id", boardAId)
        .limit(1)
        .single();
      const colAId = (colData as { id: string }).id;

      const { error: cellErr } = await userAAnon.from("cell_values").upsert(
        {
          org_id: orgAId,
          board_id: boardAId,
          item_id: itemAId,
          column_id: colAId,
          value: { text: "hello" } as never,
        },
        { onConflict: "item_id,column_id" },
      );
      expect(cellErr, "seed cell value").toBeNull();

      // ── userB in a separate org (NOT a member of orgA) ──────────────────────
      const emailB = `rls-dupboard-b-${randomUUID()}@example.com`;
      const { data: createdB, error: errB } = await admin.auth.admin.createUser(
        {
          email: emailB,
          password: PASSWORD,
          email_confirm: true,
        },
      );
      expect(errB, "createUser(B)").toBeNull();
      createdUserIds.push(createdB.user!.id);

      userBAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(userBAnon, { email: emailB, password: PASSWORD });

      await userBAnon.rpc("create_organization", {
        p_name: "Org B (dup-board)",
        p_slug: `dupb-b-${randomUUID().slice(0, 8)}`,
      });

      // ── userC: a member of orgA, but NOT the owner of board A and no share ───
      const emailC = `rls-dupboard-c-${randomUUID()}@example.com`;
      const { data: createdC, error: errC } = await admin.auth.admin.createUser(
        {
          email: emailC,
          password: PASSWORD,
          email_confirm: true,
        },
      );
      expect(errC, "createUser(C)").toBeNull();
      const userCId = createdC.user!.id;
      createdUserIds.push(userCId);

      // Add userC to orgA as a plain member via service-role (bypasses RLS).
      const { error: addCErr } = await admin.from("org_members").insert({
        org_id: orgAId,
        user_id: userCId,
        role: "member",
      });
      expect(addCErr, "add userC to orgA").toBeNull();

      userCAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(userCAnon, { email: emailC, password: PASSWORD });
    }, 90_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("duplicates groups, columns and views but NOT items/cell_values", async () => {
      const { data: dup, error } = await userAAnon.rpc(
        "duplicate_board_structure",
        { p_board_id: boardAId },
      );
      expect(error).toBeNull();
      expect(dup).toBeTruthy();
      expect(dup!.id).not.toBe(boardAId);
      expect(dup!.name).toBe("Source Board (copy)");

      const [groups, columns, views, items, cells] = await Promise.all([
        admin.from("groups").select("id").eq("board_id", dup!.id),
        admin.from("columns").select("id").eq("board_id", dup!.id),
        admin.from("board_views").select("id").eq("board_id", dup!.id),
        admin.from("items").select("id").eq("board_id", dup!.id),
        admin.from("cell_values").select("item_id").eq("board_id", dup!.id),
      ]);

      // create_board seeds 1 group + 3 columns + 1 view → all copied.
      expect(groups.data!.length).toBe(1);
      expect(columns.data!.length).toBe(3);
      expect(views.data!.length).toBe(SEEDED_VIEWS);
      // Structure-only: items and their cell_values are NOT copied.
      expect(items.data!.length).toBe(0);
      expect(cells.data!.length).toBe(0);
    });

    it("denies duplication to a non-member (cross-tenant)", async () => {
      const { error } = await userBAnon.rpc("duplicate_board_structure", {
        p_board_id: boardAId,
      });
      expect(error).not.toBeNull();
    });

    it("denies duplication to an org member who cannot read the board", async () => {
      const { error } = await userCAnon.rpc("duplicate_board_structure", {
        p_board_id: boardAId,
      });
      expect(error).not.toBeNull();
    });
  },
);
