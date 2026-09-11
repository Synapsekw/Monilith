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

/**
 * `board_intelligence_runs` caches a Board Intelligence brief + suggestions
 * per (board, user): "your row, and only your row, on a board you can read".
 * `apply_intelligence_cells` is the one-transaction RPC that writes a
 * suggestion's cell edits under the caller's own RLS (SECURITY INVOKER, no
 * privilege escalation) and stamps `item_activities.source = 'intelligence'`
 * for the rows it writes, versus `'user'` for an ordinary cell edit. These
 * probes pin both against the live database rather than against the policy
 * text.
 */
describe.skipIf(!integrationTargetReady())(
  "RLS: board_intelligence_runs",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    let owner: {
      id: string;
      orgId: string;
      workspaceId: string;
      boardId: string;
      groupId: string;
      anon: SupabaseClient<Database>;
    };
    // Same org, shared onto the board as editor.
    let other: { id: string; anon: SupabaseClient<Database> };
    // Different org entirely: cannot see the board.
    let outsider: { id: string; anon: SupabaseClient<Database> };
    // Same org, shared onto the board as viewer (can_read_board but not
    // can_edit_board) — `other` is already the editor persona, so a viewer
    // needs its own persona.
    let viewer: { id: string; anon: SupabaseClient<Database> };

    async function makeUser(label: string) {
      const email = `boardintel-${label}-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, `createUser(${label})`).toBeNull();
      const id = created.user!.id;
      createdUserIds.push(id);
      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
      return { id, email, anon };
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const o = await makeUser("owner");
      const { data: org } = await o.anon.rpc("create_organization", {
        p_name: "Board Intelligence Org",
        p_slug: `boardintel-${randomUUID().slice(0, 8)}`,
      });
      const orgId = (org as { id: string }).id;
      const { data: ws } = await o.anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: o.id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;
      const { data: board } = await o.anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: "Intelligence Board",
      });
      const boardId = (board as { id: string }).id;
      const { data: group } = await o.anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      const groupId = (group as { id: string }).id;
      owner = { id: o.id, orgId, workspaceId, boardId, groupId, anon: o.anon };

      const ot = await makeUser("other");
      await admin
        .from("org_members")
        .insert([{ org_id: orgId, user_id: ot.id, role: "member" }]);
      // `boards: read if can read` needs org membership AND creator-or-board-
      // member, so the second user has to be shared onto the board before the
      // RPC's RLS-filtered board lookup can resolve for them.
      await owner.anon.rpc("share_board", {
        p_board_id: boardId,
        p_user_id: ot.id,
        p_access: "editor",
      });
      other = { id: ot.id, anon: ot.anon };

      const out = await makeUser("outsider");
      await out.anon.rpc("create_organization", {
        p_name: "Outsider Org",
        p_slug: `boardintel-out-${randomUUID().slice(0, 8)}`,
      });
      outsider = { id: out.id, anon: out.anon };

      const v = await makeUser("viewer");
      await admin
        .from("org_members")
        .insert([{ org_id: orgId, user_id: v.id, role: "member" }]);
      await owner.anon.rpc("share_board", {
        p_board_id: boardId,
        p_user_id: v.id,
        p_access: "viewer",
      });
      viewer = { id: v.id, anon: v.anon };
    }, 90_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("a user reads and writes only their own run rows", async () => {
      const { error: insErr } = await owner.anon
        .from("board_intelligence_runs")
        .insert({
          org_id: owner.orgId,
          board_id: owner.boardId,
          user_id: owner.id,
          input_hash: "h1",
          payload: { brief: "b", suggestions: [], signals: [] },
        });
      expect(insErr).toBeNull();
      const mine = await owner.anon
        .from("board_intelligence_runs")
        .select("id")
        .eq("board_id", owner.boardId);
      expect(mine.data).toHaveLength(1);
      const theirs = await other.anon
        .from("board_intelligence_runs")
        .select("id")
        .eq("board_id", owner.boardId);
      expect(theirs.data).toEqual([]);
    });

    it("an outsider cannot insert a run for a board they cannot read", async () => {
      const { error } = await outsider.anon
        .from("board_intelligence_runs")
        .insert({
          org_id: owner.orgId,
          board_id: owner.boardId,
          user_id: outsider.id,
          input_hash: "h",
          payload: { brief: "", suggestions: [], signals: [] },
        });
      expect(error).not.toBeNull();
    });

    it("apply_intelligence_cells writes in one transaction and returns before-values", async () => {
      // A text column + one item, created by the owner.
      const { data: col } = await owner.anon
        .from("columns")
        .insert({
          org_id: owner.orgId,
          board_id: owner.boardId,
          name: "Notes",
          kind: "text",
          position: 0,
        })
        .select("id")
        .single();
      const { data: item } = await owner.anon
        .from("items")
        .insert({
          org_id: owner.orgId,
          board_id: owner.boardId,
          group_id: owner.groupId,
          name: "Row",
          position: 0,
        })
        .select("id")
        .single();
      const res = await owner.anon.rpc("apply_intelligence_cells", {
        p_board_id: owner.boardId,
        p_writes: [
          { item_id: item!.id, column_id: col!.id, value: { text: "hello" } },
        ],
      });
      expect(res.error).toBeNull();
      const out = res.data as {
        before: { value: unknown }[];
        cells: unknown[];
      };
      expect(out.before[0]?.value).toBeNull(); // cell was empty
      expect(out.cells).toHaveLength(1);
      const act = await owner.anon
        .from("item_activities")
        .select("source")
        .eq("item_id", item!.id)
        .eq("action", "cell_changed");
      expect(act.data?.map((a) => a.source)).toEqual(["intelligence"]);
      // Replaying the before-value clears the cell again.
      const undo = await owner.anon.rpc("apply_intelligence_cells", {
        p_board_id: owner.boardId,
        p_writes: [{ item_id: item!.id, column_id: col!.id, value: null }],
      });
      expect(undo.error).toBeNull();
      const cells = await owner.anon
        .from("cell_values")
        .select("id")
        .eq("item_id", item!.id);
      expect(cells.data).toEqual([]);
    });

    it("a viewer's apply is rejected and writes nothing", async () => {
      const { data: col } = await owner.anon
        .from("columns")
        .select("id")
        .eq("board_id", owner.boardId)
        .eq("name", "Notes")
        .single();
      const { data: item } = await owner.anon
        .from("items")
        .select("id")
        .eq("board_id", owner.boardId)
        .eq("name", "Row")
        .single();
      const res = await viewer.anon.rpc("apply_intelligence_cells", {
        p_board_id: owner.boardId,
        p_writes: [
          { item_id: item!.id, column_id: col!.id, value: { text: "nope" } },
        ],
      });
      expect(res.error).not.toBeNull();
      const cells = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", item!.id);
      expect(
        cells.data?.some((c) => JSON.stringify(c.value).includes("nope")),
      ).toBe(false);

      // The clear path (value: null) is a delete filtered by RLS, not a
      // rejected write — without the guard it "succeeds" on zero rows. Seed
      // a real value as admin, then confirm a viewer's clear is rejected and
      // the value survives.
      const { error: seedErr } = await admin.from("cell_values").upsert(
        {
          org_id: owner.orgId,
          board_id: owner.boardId,
          item_id: item!.id,
          column_id: col!.id,
          value: { text: "seeded" },
        },
        { onConflict: "item_id,column_id" },
      );
      expect(seedErr).toBeNull();
      const clearRes = await viewer.anon.rpc("apply_intelligence_cells", {
        p_board_id: owner.boardId,
        p_writes: [{ item_id: item!.id, column_id: col!.id, value: null }],
      });
      expect(clearRes.error).not.toBeNull();
      const stillThere = await admin
        .from("cell_values")
        .select("value")
        .eq("item_id", item!.id)
        .eq("column_id", col!.id);
      expect(stillThere.data).toHaveLength(1);
    });

    it("an ordinary cell write still logs source = user", async () => {
      const { data: col } = await owner.anon
        .from("columns")
        .select("id")
        .eq("board_id", owner.boardId)
        .eq("name", "Notes")
        .single();
      const { data: item } = await owner.anon
        .from("items")
        .select("id")
        .eq("board_id", owner.boardId)
        .eq("name", "Row")
        .single();
      const { error: upsertErr } = await owner.anon.from("cell_values").upsert(
        {
          org_id: owner.orgId,
          board_id: owner.boardId,
          item_id: item!.id,
          column_id: col!.id,
          value: { text: "plain" },
        },
        { onConflict: "item_id,column_id" },
      );
      expect(upsertErr).toBeNull();
      const act = await owner.anon
        .from("item_activities")
        .select("source")
        .eq("item_id", item!.id)
        .order("created_at", { ascending: false })
        .limit(1);
      expect(act.data?.[0]?.source).toBe("user");
    });
  },
);
