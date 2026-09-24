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

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
}

describe.skipIf(!integrationTargetReady())(
  "folder_burn + folder_workload + folder_gallery",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let member: SupabaseClient<Database>;
    let outsider: SupabaseClient<Database>;
    let memberId: string;
    let outsiderId: string;
    let orgId: string;
    let wsId: string;
    let folderId: string;
    let emptyFolderId: string;
    let boardId: string;
    let groupId: string;
    let statusColId: string;
    let peopleColId: string;
    let dateColId: string;
    let doneOptId: string;

    async function provision(label: string) {
      const email = `fb-${label}-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      expect(error, `createUser(${label})`).toBeNull();
      createdUserIds.push(created.user!.id);
      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
      return { anon, userId: created.user!.id };
    }

    async function seedItem(opts: {
      name: string;
      parentId?: string;
      statusOptionId?: string;
      ownerIds?: string[];
      date?: string;
    }): Promise<string> {
      const { data: item, error } = await member
        .from("items")
        .insert({
          board_id: boardId,
          org_id: orgId,
          group_id: groupId,
          name: opts.name,
          ...(opts.parentId ? { parent_id: opts.parentId } : {}),
        })
        .select("id")
        .single();
      expect(error, `seedItem(${opts.name})`).toBeNull();
      const itemId = (item as { id: string }).id;
      const cells: { column_id: string; value: Json }[] = [];
      if (opts.statusOptionId)
        cells.push({
          column_id: statusColId,
          value: { optionId: opts.statusOptionId },
        });
      if (opts.ownerIds)
        cells.push({
          column_id: peopleColId,
          value: { userIds: opts.ownerIds },
        });
      if (opts.date)
        cells.push({ column_id: dateColId, value: { date: opts.date } });
      for (const c of cells) {
        const { error: cellErr } = await member.from("cell_values").insert({
          item_id: itemId,
          column_id: c.column_id,
          board_id: boardId,
          org_id: orgId,
          value: c.value,
        });
        expect(cellErr, `cell(${opts.name})`).toBeNull();
      }
      return itemId;
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const m = await provision("member");
      member = m.anon;
      memberId = m.userId;
      const o = await provision("outsider");
      outsider = o.anon;
      outsiderId = o.userId;

      const { data: org } = await member.rpc("create_organization", {
        p_name: "Burn Org",
        p_slug: `fb-${randomUUID().slice(0, 8)}`,
      });
      orgId = (org as { id: string }).id;
      const { data: ws } = await member
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: memberId })
        .select("id")
        .single();
      wsId = (ws as { id: string }).id;

      const { data: board } = await member.rpc("create_board", {
        p_workspace_id: wsId,
        p_name: "Plan",
      });
      boardId = (board as { id: string }).id;
      const { data: g } = await member
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      groupId = (g as { id: string }).id;
      const { data: cols } = await member
        .from("columns")
        .select("id, kind, settings")
        .eq("board_id", boardId);
      const statusCol = cols!.find((c) => c.kind === "status")!;
      statusColId = statusCol.id;
      peopleColId = cols!.find((c) => c.kind === "people")!.id;
      dateColId = cols!.find((c) => c.kind === "date")!.id;
      const options = (
        statusCol.settings as { options: { id: string; label: string }[] }
      ).options;
      doneOptId = options.find((x) => x.label === "Done")!.id;

      const { data: folder } = await member
        .from("folders")
        .insert({
          org_id: orgId,
          workspace_id: wsId,
          name: "Launch",
          created_by: memberId,
        })
        .select("id")
        .single();
      folderId = (folder as { id: string }).id;
      const { data: empty } = await member
        .from("folders")
        .insert({
          org_id: orgId,
          workspace_id: wsId,
          name: "Empty",
          created_by: memberId,
        })
        .select("id")
        .single();
      emptyFolderId = (empty as { id: string }).id;
      const { error: fbErr } = await member
        .from("folder_boards")
        .insert({ folder_id: folderId, board_id: boardId });
      expect(fbErr).toBeNull();

      // Two due dates three weeks apart (planned in two different ISO weeks),
      // one done item (its status cell was written "now", so completed lands
      // in the current week), one open item with two owners, one with none.
      await seedItem({
        name: "p-early",
        ownerIds: [memberId],
        date: isoDaysFromNow(-21),
      });
      await seedItem({
        name: "p-late",
        ownerIds: [memberId],
        date: isoDaysFromNow(7),
      });
      await seedItem({
        name: "c-done",
        statusOptionId: doneOptId,
        ownerIds: [memberId],
        date: isoDaysFromNow(-1),
      });
      await seedItem({ name: "two-owners", ownerIds: [memberId, outsiderId] });
      await seedItem({ name: "nobody" });
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("returns contiguous ISO weeks per stage spanning the folder's due/done dates", async () => {
      const { data, error } = await member.rpc("folder_burn", {
        p_folder_id: folderId,
      });
      expect(error).toBeNull();
      const rows = data!;
      expect(rows.length).toBeGreaterThan(0);
      const stageKeys = new Set(rows.map((r) => r.stage_key));
      expect(stageKeys).toEqual(new Set(["group 1"])); // lower(trim("Group 1"))
      for (let i = 1; i < rows.length; i++) {
        const prev = new Date(rows[i - 1].week_start).getTime();
        const cur = new Date(rows[i].week_start).getTime();
        expect(cur - prev).toBe(7 * 864e5); // contiguous weeks, one stage
      }
      for (const r of rows) {
        expect(new Date(r.week_start).getUTCDay()).toBe(1); // Monday
      }
      expect(rows.reduce((s, r) => s + r.planned, 0)).toBe(3); // three due dates
      expect(rows.reduce((s, r) => s + r.completed, 0)).toBe(1);
    });

    it("counts open items once per owner and puts ownerless items on the null row", async () => {
      const { data, error } = await member.rpc("folder_workload", {
        p_folder_id: folderId,
      });
      expect(error).toBeNull();
      const byUser = new Map<string | null, number>();
      for (const r of data!)
        byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + r.open_items);
      expect(byUser.get(memberId)).toBe(3); // p-early, p-late, two-owners (c-done excluded)
      expect(byUser.get(outsiderId)).toBe(1);
      expect(byUser.get(null)).toBe(1); // nobody
      expect(data!.every((r) => r.stage_key === "group 1")).toBe(true);
    });

    it("returns per-folder gallery counts for the workspace", async () => {
      const { data, error } = await member.rpc("folder_gallery", {
        p_workspace_id: wsId,
      });
      expect(error).toBeNull();
      const row = data!.find((r) => r.folder_id === folderId)!;
      expect(row).toMatchObject({
        board_count: 1,
        item_count: 5,
        done_count: 1,
        overdue_count: 1,
      });
      expect(row.attention_count).toBe(2); // p-early (overdue) + nobody (unassigned)
      const empty = data!.find((r) => r.folder_id === emptyFolderId)!;
      expect(empty).toMatchObject({
        board_count: 0,
        item_count: 0,
        attention_count: 0,
      });
    });

    it("returns empty sets for a folder with no boards", async () => {
      const burn = await member.rpc("folder_burn", {
        p_folder_id: emptyFolderId,
      });
      expect(burn.error).toBeNull();
      expect(burn.data).toEqual([]);
      const wl = await member.rpc("folder_workload", {
        p_folder_id: emptyFolderId,
      });
      expect(wl.error).toBeNull();
      expect(wl.data).toEqual([]);
    });

    it("rejects a non-member on all three with the same generic not-found code", async () => {
      // _assert_folder_member (folder_burn, folder_workload) and
      // folder_gallery's own workspace guard both collapse "not found" and
      // "not a member" into a single P0002 — a distinct 42501 would be a
      // cross-org existence oracle (see this migration's header).
      expect(
        (await outsider.rpc("folder_burn", { p_folder_id: folderId })).error
          ?.code,
      ).toBe("P0002");
      expect(
        (await outsider.rpc("folder_workload", { p_folder_id: folderId })).error
          ?.code,
      ).toBe("P0002");
      expect(
        (await outsider.rpc("folder_gallery", { p_workspace_id: wsId })).error
          ?.code,
      ).toBe("P0002");
    });

    it("excludes a board the caller cannot read from burn, workload and gallery counts", async () => {
      // member is an org member of orgId (can read folder F) but holds no
      // board_members grant on board2 and did not create it — board2 must
      // contribute no bucket to folder_burn, no row to folder_workload, and
      // no count to folder_gallery (ruling 2). Placed as the LAST test so it
      // doesn't disturb the earlier tests' fixture assumptions.
      const boardmate = await provision("boardmate");
      const { error: memErr } = await admin.from("org_members").insert({
        org_id: orgId,
        user_id: boardmate.userId,
        role: "member",
      });
      expect(memErr, "add boardmate to org").toBeNull();

      const { data: board2, error: board2Err } = await boardmate.anon.rpc(
        "create_board",
        { p_workspace_id: wsId, p_name: "Boardmate Only" },
      );
      expect(board2Err, "create_board(board2)").toBeNull();
      const board2Id = (board2 as { id: string }).id;

      const { data: group2, error: group2Err } = await boardmate.anon
        .from("groups")
        .select("id")
        .eq("board_id", board2Id)
        .single();
      expect(group2Err, "read group2").toBeNull();
      const group2Id = (group2 as { id: string }).id;

      const { data: cols2, error: cols2Err } = await boardmate.anon
        .from("columns")
        .select("id, kind")
        .eq("board_id", board2Id);
      expect(cols2Err, "read board2 columns").toBeNull();
      const dateCol2Id = cols2!.find((c) => c.kind === "date")!.id;
      const peopleCol2Id = cols2!.find((c) => c.kind === "people")!.id;

      const { error: fb2Err } = await boardmate.anon
        .from("folder_boards")
        .insert({ folder_id: folderId, board_id: board2Id });
      expect(fb2Err, "link board2 to folder").toBeNull();

      const { data: item2, error: item2Err } = await boardmate.anon
        .from("items")
        .insert({
          board_id: board2Id,
          org_id: orgId,
          group_id: group2Id,
          name: "hidden-from-member",
        })
        .select("id")
        .single();
      expect(item2Err, "seed item on board2").toBeNull();
      const item2Id = (item2 as { id: string }).id;

      // A due date + owner on the hidden item: if either RPC leaked board2,
      // planned/completed or open_items counts below would change.
      const { error: cell2Err } = await boardmate.anon
        .from("cell_values")
        .insert([
          {
            item_id: item2Id,
            column_id: dateCol2Id,
            board_id: board2Id,
            org_id: orgId,
            value: { date: isoDaysFromNow(-2) },
          },
          {
            item_id: item2Id,
            column_id: peopleCol2Id,
            board_id: board2Id,
            org_id: orgId,
            value: { userIds: [boardmate.userId] },
          },
        ]);
      expect(cell2Err, "seed cells on board2 item").toBeNull();

      const { data: gallery, error: galleryErr } = await member.rpc(
        "folder_gallery",
        { p_workspace_id: wsId },
      );
      expect(galleryErr).toBeNull();
      const row = gallery!.find((r) => r.folder_id === folderId)!;
      expect(row.board_count).toBe(1); // board2 excluded
      expect(row.item_count).toBe(5); // hidden-from-member excluded

      const { data: burn, error: burnErr } = await member.rpc("folder_burn", {
        p_folder_id: folderId,
      });
      expect(burnErr).toBeNull();
      expect(burn!.reduce((s, r) => s + r.planned, 0)).toBe(3); // unchanged
      expect(burn!.reduce((s, r) => s + r.completed, 0)).toBe(1); // unchanged

      const { data: workload, error: workloadErr } = await member.rpc(
        "folder_workload",
        { p_folder_id: folderId },
      );
      expect(workloadErr).toBeNull();
      expect(workload!.map((r) => r.board_id)).not.toContain(board2Id);
    });
  },
);
