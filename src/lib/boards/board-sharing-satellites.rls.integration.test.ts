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

// Every board-scoped satellite read table that exposes a queryable board_id.
// (automation_date_fires / automation_webhook_deliveries scope via a parent FK,
// not board_id — asserted separately below.)
const SATELLITE_READ_TABLES = [
  "item_dependencies",
  "attachments",
  "item_updates",
  "item_activities",
  "time_entries",
  "automations",
  "automation_runs",
] as const;

describe.skipIf(!SERVICE_ROLE_KEY)(
  "RLS: board-sharing satellite-table privacy + storage",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    const uploadedPaths: string[] = [];

    let owner: {
      id: string;
      orgId: string;
      workspaceId: string;
      boardId: string;
      groupId: string;
      itemId: string;
      columnId: string;
      automationId: string;
      anon: SupabaseClient<Database>;
    };
    let outsider: { id: string; anon: SupabaseClient<Database> };
    let viewer: { id: string; anon: SupabaseClient<Database> };

    async function makeUser(label: string) {
      const email = `sat-${label}-${randomUUID()}@example.com`;
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

      // ── Owner provisions org / workspace / private board / group / item ──
      const o = await makeUser("owner");
      const { data: org } = await o.anon.rpc("create_organization", {
        p_name: "Sat Org",
        p_slug: `sat-${randomUUID().slice(0, 8)}`,
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
        p_name: "Private Board",
      });
      const boardId = (board as { id: string }).id;
      const { data: group } = await o.anon
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      const groupId = (group as { id: string }).id;
      const { data: item } = await o.anon.rpc("create_item", {
        p_group_id: groupId,
        p_name: "Item",
      });
      const itemId = (item as { id: string }).id;
      // a time_tracking column on this board (needed for start_timer below)
      const { data: col, error: colErr } = await o.anon
        .from("columns")
        .insert({
          org_id: orgId,
          board_id: boardId,
          name: "Time",
          kind: "time_tracking",
          position: 1000,
        })
        .select("id")
        .single();
      expect(colErr, "owner insert time_tracking column").toBeNull();
      const columnId = (col as { id: string }).id;

      // ── Seed one row in each satellite table so the outsider's read targets
      //    existing rows (an empty table would also prove no leak, but a seeded
      //    row is stronger). Owner-insertable tables go through the anon client;
      //    system/engine-written tables go through the service-role admin client
      //    (bypasses RLS). ──

      // item_updates: owner-authored comment
      const { error: updErr } = await o.anon.from("item_updates").insert({
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        author_id: o.id,
        body: { text: "owner comment" },
        body_text: "owner comment",
      });
      expect(updErr, "seed item_updates").toBeNull();

      // attachments: owner-uploaded metadata row
      const { error: attErr } = await o.anon.from("attachments").insert({
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        uploaded_by: o.id,
        storage_path: `${orgId}/${boardId}/${itemId}/${randomUUID()}-seed.txt`,
        file_name: "seed.txt",
        mime_type: "text/plain",
        size_bytes: 2,
      });
      expect(attErr, "seed attachments").toBeNull();

      // time_entries: a completed manual entry owned by the owner
      const { error: teErr } = await o.anon.from("time_entries").insert({
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        column_id: columnId,
        user_id: o.id,
        started_at: new Date(Date.now() - 60_000).toISOString(),
        ended_at: new Date().toISOString(),
        duration_secs: 60,
      });
      expect(teErr, "seed time_entries").toBeNull();

      // automations: owner-created rule
      const { data: auto, error: autoErr } = await o.anon
        .from("automations")
        .insert({
          org_id: orgId,
          board_id: boardId,
          name: "rule",
          trigger: { type: "status_changes" },
          actions: [],
          created_by: o.id,
        })
        .select("id")
        .single();
      expect(autoErr, "seed automations").toBeNull();
      const automationId = (auto as { id: string }).id;

      // item_activities: engine/trigger-written → seed via service role
      const { error: actErr } = await admin.from("item_activities").insert({
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        actor_id: o.id,
        action: "item_created",
        new_value: { name: "Item" },
      });
      expect(actErr, "seed item_activities").toBeNull();

      // automation_runs: engine-written → seed via service role
      const { error: runErr } = await admin.from("automation_runs").insert({
        automation_id: automationId,
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        trigger_type: "status_changes",
        status: "ran",
        actions: [],
      });
      expect(runErr, "seed automation_runs").toBeNull();

      owner = {
        id: o.id,
        orgId,
        workspaceId,
        boardId,
        groupId,
        itemId,
        columnId,
        automationId,
        anon: o.anon,
      };

      // ── outsider (ungranted org member) + viewer (will be granted) ──
      const out = await makeUser("outsider");
      const vw = await makeUser("viewer");
      await admin.from("org_members").insert([
        { org_id: orgId, user_id: out.id, role: "member" },
        { org_id: orgId, user_id: vw.id, role: "member" },
      ]);
      outsider = { id: out.id, anon: out.anon };
      viewer = { id: vw.id, anon: vw.anon };
    }, 120_000);

    afterAll(async () => {
      if (uploadedPaths.length > 0) {
        await admin.storage.from("attachments").remove(uploadedPaths);
      }
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    // ── PART 2: satellite-table read privacy ──────────────────────────────

    it("an ungranted member reads zero rows from every satellite table", async () => {
      for (const t of SATELLITE_READ_TABLES) {
        const { data } = await outsider.anon
          .from(t)
          .select("*")
          .eq("board_id", owner.boardId);
        expect(data ?? [], `read ${t}`).toEqual([]);
      }
    });

    it("an ungranted member reads zero parent-scoped automation log rows", async () => {
      // automation_date_fires scopes via automation_id; automation_webhook_deliveries
      // via run_id. Neither carries board_id. Filter by the parent FK.
      const { data: fires } = await outsider.anon
        .from("automation_date_fires")
        .select("*")
        .eq("automation_id", owner.automationId);
      expect(fires ?? [], "read automation_date_fires").toEqual([]);

      const { data: deliveries } = await outsider.anon
        .from("automation_webhook_deliveries")
        .select("*")
        .eq("org_id", owner.orgId);
      expect(deliveries ?? [], "read automation_webhook_deliveries").toEqual(
        [],
      );
    });

    it("a viewer (granted) CAN read item_updates but CANNOT insert a comment", async () => {
      const { error: shareErr } = await owner.anon.rpc("share_board", {
        p_board_id: owner.boardId,
        p_user_id: viewer.id,
        p_access: "viewer",
      });
      expect(shareErr).toBeNull();

      const { data: reads } = await viewer.anon
        .from("item_updates")
        .select("id")
        .eq("board_id", owner.boardId);
      expect(
        (reads ?? []).length,
        "viewer reads seeded comment",
      ).toBeGreaterThan(0);

      const { data: inserted } = await viewer.anon
        .from("item_updates")
        .insert({
          org_id: owner.orgId,
          board_id: owner.boardId,
          item_id: owner.itemId,
          author_id: viewer.id,
          body: { text: "nope" },
          body_text: "nope",
        })
        .select("id");
      expect(inserted ?? [], "viewer insert comment blocked").toEqual([]);
    });

    it("a viewer CANNOT start a timer", async () => {
      const { error } = await viewer.anon.rpc("start_timer", {
        p_item_id: owner.itemId,
        p_column_id: owner.columnId,
      });
      expect(error, "viewer start_timer denied").not.toBeNull();
    });

    // ── PART 3: storage read-denial (proves the Critical fix) ─────────────

    it("storage: ungranted member is DENIED download; granted viewer SUCCEEDS", async () => {
      const path = `${owner.orgId}/${owner.boardId}/${owner.itemId}/${randomUUID()}-test.txt`;

      // 1) Owner uploads a tiny file — must succeed.
      const { error: upErr } = await owner.anon.storage
        .from("attachments")
        .upload(path, new Blob(["hi"]), { contentType: "text/plain" });
      expect(upErr, "owner upload").toBeNull();
      uploadedPaths.push(path);

      // 2) Ungranted outsider attempts download — must be DENIED (error or no data).
      const outDl = await outsider.anon.storage
        .from("attachments")
        .download(path);
      expect(
        outDl.error !== null || outDl.data === null,
        "outsider download denied",
      ).toBe(true);

      // 3) Grant the viewer, then the SAME download must SUCCEED.
      const { error: shareErr } = await owner.anon.rpc("share_board", {
        p_board_id: owner.boardId,
        p_user_id: viewer.id,
        p_access: "viewer",
      });
      expect(shareErr).toBeNull();

      const vwDl = await viewer.anon.storage.from("attachments").download(path);
      expect(vwDl.error, "viewer download error").toBeNull();
      expect(vwDl.data, "viewer download data").not.toBeNull();
      // Non-empty payload confirms the bytes came through (exact content isn't
      // asserted: the jsdom test env round-trips the upload Blob as FormData).
      expect(
        (vwDl.data as Blob).size,
        "viewer downloaded bytes",
      ).toBeGreaterThan(0);
    });
  },
);
