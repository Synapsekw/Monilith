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

// Cross-board RLS proof for MIRROR columns (Phase 6d-2, Task 6).
//
// A mirror cell on board A surfaces a `cell_values` value that lives on board B
// (the relation target). The security rule (identical to 6d-1's linked-name
// filter and the board-sharing storage-RLS fix): a viewer of board A who is NOT
// a member of board B gets NO target value back — RLS filters it, the mirror
// renders empty. We prove this at the DATA layer: we assert what each user's
// RLS-scoped client can read from `cell_values`.
describe.skipIf(!integrationTargetReady())(
  "RLS: mirror columns (cross-board)",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    // owner: org + board A (owning) + board B (target). outsider: org member,
    // shared into A as VIEWER, NOT a member of B.
    let owner: SupabaseClient<Database>;
    let outsider: SupabaseClient<Database>;
    let orgId: string;
    let itemA: string; // owning item on board A
    let relR: string; // relation column on A → B (the mirror's source relation)
    let colT: string; // source column on board B (the mirrored target)
    let b1: string; // linked item on board B

    async function makeUser(label: string) {
      const email = `mirror-${label}-${randomUUID()}@example.com`;
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
      return { id, anon };
    }

    async function makeBoard(
      client: SupabaseClient<Database>,
      workspaceId: string,
      name: string,
    ) {
      const { data: board } = await client.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: name,
      });
      const boardId = (board as { id: string }).id;
      const { data: group } = await client
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      return { boardId, groupId: (group as { id: string }).id };
    }

    async function makeItem(
      client: SupabaseClient<Database>,
      groupId: string,
      name: string,
    ) {
      const { data: item } = await client.rpc("create_item", {
        p_group_id: groupId,
        p_name: name,
      });
      return (item as { id: string }).id;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const o = await makeUser("owner");
      owner = o.anon;
      const { data: org } = await o.anon.rpc("create_organization", {
        p_name: "Mirror Org",
        p_slug: `mirror-${randomUUID().slice(0, 8)}`,
      });
      orgId = (org as { id: string }).id;
      const { data: ws } = await o.anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: o.id })
        .select("id")
        .single();
      const workspaceId = (ws as { id: string }).id;

      const boardA = await makeBoard(o.anon, workspaceId, "Tasks");
      const boardB = await makeBoard(o.anon, workspaceId, "Projects");
      itemA = await makeItem(o.anon, boardA.groupId, "Ship onboarding");
      b1 = await makeItem(o.anon, boardB.groupId, "Acquisition Q3");

      // Board B: a source TEXT column T, with a value set on (b1, T).
      const { data: tCol, error: tErr } = await o.anon
        .from("columns")
        .insert({
          org_id: orgId,
          board_id: boardB.boardId,
          name: "Status",
          kind: "text",
          position: 1000,
          settings: {},
        })
        .select("id")
        .single();
      expect(tErr, "insert target column T on board B").toBeNull();
      colT = (tCol as { id: string }).id;

      const { error: cvErr } = await o.anon.from("cell_values").insert({
        org_id: orgId,
        board_id: boardB.boardId,
        item_id: b1,
        column_id: colT,
        value: { text: "On track" },
      });
      expect(cvErr, "set cell value on (b1, T)").toBeNull();

      // Board A: relation column R → board B, and a mirror column M referencing
      // R as its source relation and T as the mirrored target column.
      const { data: rCol, error: rErr } = await o.anon
        .from("columns")
        .insert({
          org_id: orgId,
          board_id: boardA.boardId,
          name: "Projects",
          kind: "relation",
          position: 1000,
          settings: { target_board_id: boardB.boardId, allow_multiple: true },
        })
        .select("id")
        .single();
      expect(rErr, "insert relation column R on board A").toBeNull();
      relR = (rCol as { id: string }).id;

      // Mirror column M on A: derives from R (source relation) + T (target column).
      // M stores no rows of its own; the proof reads the target `cell_values`
      // directly (what M would surface), so M's id is not needed for assertions.
      const { error: mErr } = await o.anon.from("columns").insert({
        org_id: orgId,
        board_id: boardA.boardId,
        name: "Project status",
        kind: "mirror",
        position: 1001,
        settings: {
          source_relation_column_id: relR,
          target_column_id: colT,
        },
      });
      expect(mErr, "insert mirror column M on board A").toBeNull();

      // Link itemA → [b1] through R (cross-board relation RPC, as 6d-1 does).
      const { error: linkErr } = await o.anon.rpc("set_relation_links", {
        p_item_id: itemA,
        p_column_id: relR,
        p_linked_item_ids: [b1],
      });
      expect(linkErr, "link itemA → b1 through R").toBeNull();

      // outsider: org member, shared into board A as VIEWER, NOT a member of B.
      const out = await makeUser("outsider");
      outsider = out.anon;
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: out.id, role: "member" });
      const { error: shareErr } = await o.anon.from("board_members").insert({
        board_id: boardA.boardId,
        org_id: orgId,
        user_id: out.id,
        access_level: "viewer",
        granted_by: o.id,
      });
      expect(shareErr, "share board A with outsider as viewer").toBeNull();
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("owner (member of B) reads the mirrored source cell", async () => {
      const { data, error } = await owner
        .from("cell_values")
        .select("value")
        .eq("item_id", b1)
        .eq("column_id", colT);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].value).toEqual({ text: "On track" });
    });

    it("outsider (viewer of A, non-member of B) CANNOT read the mirrored source cell", async () => {
      // Core security assertion: the mirror analogue of 6d-1's "viewer of A can't
      // see the linked NAME". RLS on board B filters the cell → mirror renders empty.
      const { data, error } = await outsider
        .from("cell_values")
        .select("value")
        .eq("item_id", b1)
        .eq("column_id", colT);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("outsider still sees the relation link row (board A readable)", async () => {
      const { data, error } = await outsider
        .from("relation_links")
        .select("id, linked_item_id")
        .eq("item_id", itemA)
        .eq("column_id", relR);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].linked_item_id).toBe(b1);
    });

    // Deleting the mirrored target column T succeeds and the cell cascades away, so
    // the mirror renders empty with no error. This was a pre-existing production bug
    // (the column delete aborted with FK 23503 because `tg_log_cell_activity`'s
    // DELETE branch logged an activity row referencing the column being dropped),
    // fixed in migration 20260621150000 by also guarding on the column still
    // existing. This test is the regression proof: T had a value set above (which
    // logged cell activity), so deleting it exercises the exact path that used to
    // fail. (Runs last — mutates.)
    it("deleting the target column T makes the mirror source unresolvable without error (runs last — mutates)", async () => {
      const { error: delErr } = await owner
        .from("columns")
        .delete()
        .eq("id", colT);
      expect(delErr).toBeNull();
      // cell_values cascades via the column_id FK (on delete cascade) → the source
      // cell is gone; the mirror resolves to nothing and renders empty, no error.
      const { data, error } = await owner
        .from("cell_values")
        .select("value")
        .eq("item_id", b1)
        .eq("column_id", colT);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
