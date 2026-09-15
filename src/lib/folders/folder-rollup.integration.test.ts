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
  "folder_rollup + folder_attention",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let member: SupabaseClient<Database>;
    let outsider: SupabaseClient<Database>;
    let memberId: string;
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
    let stuckOptId: string;
    let workingOptId: string;

    async function provision(label: string) {
      const email = `fr-${label}-${randomUUID()}@example.com`;
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

      const { data: org } = await member.rpc("create_organization", {
        p_name: "Rollup Org",
        p_slug: `fr-${randomUUID().slice(0, 8)}`,
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
      stuckOptId = options.find((x) => x.label === "Stuck")!.id;
      workingOptId = options.find((x) => x.label === "Working on it")!.id;

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

      // done (past due, suppressed), overdue (working, yesterday), blocked
      // (stuck, owner), fresh (no status, tomorrow, owner), no-owner (nothing),
      // plus a subitem that must be excluded everywhere.
      await seedItem({
        name: "i-done",
        statusOptionId: doneOptId,
        ownerIds: [memberId],
        date: isoDaysFromNow(-1),
      });
      await seedItem({
        name: "i-overdue",
        statusOptionId: workingOptId,
        ownerIds: [memberId],
        date: isoDaysFromNow(-3),
      });
      await seedItem({
        name: "i-stuck",
        statusOptionId: stuckOptId,
        ownerIds: [memberId],
      });
      await seedItem({
        name: "i-fresh",
        ownerIds: [memberId],
        date: isoDaysFromNow(1),
      });
      const noOwner = await seedItem({ name: "i-no-owner" });
      await seedItem({ name: "i-sub", parentId: noOwner });
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("rolls up one row per (board, group) whose buckets sum to the top-level item count", async () => {
      const { data, error } = await member.rpc("folder_rollup", {
        p_folder_id: folderId,
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const r = data![0];
      expect(r.board_id).toBe(boardId);
      expect(r.group_id).toBe(groupId);
      expect(r.total).toBe(5);
      expect(r.done + r.in_progress + r.overdue + r.not_started).toBe(r.total);
      expect(r).toMatchObject({
        done: 1,
        overdue: 1,
        in_progress: 1, // i-stuck: has a status, not overdue
        not_started: 2, // i-fresh, i-no-owner
        blocked: 1,
        unassigned: 1,
        planned_by_today: 2, // i-done + i-overdue due in the past
      });
      expect(r.oldest_overdue).toBe(isoDaysFromNow(-3));
    });

    it("orders attention by severity then age and applies the limit in SQL", async () => {
      const { data, error } = await member.rpc("folder_attention", {
        p_folder_id: folderId,
        p_limit: 2,
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(2);
      expect(data![0]).toMatchObject({
        item_name: "i-overdue",
        reason: "overdue",
        severity: 4,
        age_days: 3,
      });
      expect(data![1]).toMatchObject({
        item_name: "i-stuck",
        reason: "blocked",
        severity: 3,
      });
    });

    it("returns the unassigned item when the limit allows", async () => {
      const { data } = await member.rpc("folder_attention", {
        p_folder_id: folderId,
        p_limit: 20,
      });
      expect(data!.map((r) => r.reason)).toEqual([
        "overdue",
        "blocked",
        "unassigned",
      ]);
    });

    it("returns empty sets, not errors, for a folder with no boards", async () => {
      const rollup = await member.rpc("folder_rollup", {
        p_folder_id: emptyFolderId,
      });
      expect(rollup.error).toBeNull();
      expect(rollup.data).toEqual([]);
      const attention = await member.rpc("folder_attention", {
        p_folder_id: emptyFolderId,
        p_limit: 20,
      });
      expect(attention.error).toBeNull();
      expect(attention.data).toEqual([]);
    });

    it("rejects a non-member and an unknown folder", async () => {
      const { error } = await outsider.rpc("folder_rollup", {
        p_folder_id: folderId,
      });
      expect(error?.code).toBe("42501");
      const missing = await member.rpc("folder_rollup", {
        p_folder_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(missing.error).not.toBeNull();
    });

    it("keeps the internal helpers unreachable", async () => {
      const { error } = await member.rpc(
        "_folder_item_flags" as never,
        { p_folder_id: folderId } as never,
      );
      expect(error).not.toBeNull();
    });
  },
);
