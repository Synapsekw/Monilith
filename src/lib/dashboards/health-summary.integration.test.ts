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

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// dashboard_health_summary RPC semantics + digest auth contract (opt-in
// live-DB suite, decision-25: skips cleanly unless a marked test target is
// configured).
describe.skipIf(!integrationTargetReady())(
  "dashboard_health_summary RPC",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    let member: SupabaseClient<Database>;
    let outsider: SupabaseClient<Database>;
    let orgId: string;
    let boardId: string;
    let board2Id: string;
    let groupId: string;
    let statusColId: string;
    let peopleColId: string;
    let dateColId: string;
    let doneOptId: string;
    let wipOptId: string;
    let memberUserId: string;

    async function provision(label: string) {
      const email = `health-${randomUUID()}@example.com`;
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password: PASSWORD,
          email_confirm: true,
        });
      expect(createErr, `createUser(${label})`).toBeNull();
      createdUserIds.push(created.user!.id);

      const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
      return { anon, userId: created.user!.id };
    }

    async function seedItem(opts: {
      boardId: string;
      groupId: string;
      name: string;
      parentId?: string;
      statusOptionId?: string;
      ownerIds?: string[];
      date?: string;
      dateColumnId?: string;
      peopleColumnId?: string;
      statusColumnId?: string;
    }): Promise<string> {
      const { data: item, error } = await member
        .from("items")
        .insert({
          board_id: opts.boardId,
          org_id: orgId,
          group_id: opts.groupId,
          name: opts.name,
          ...(opts.parentId ? { parent_id: opts.parentId } : {}),
        })
        .select("id")
        .single();
      expect(error, `seedItem(${opts.name})`).toBeNull();
      const itemId = (item as { id: string }).id;
      if (opts.statusOptionId) {
        const { error: cellErr } = await member.from("cell_values").insert({
          item_id: itemId,
          column_id: opts.statusColumnId ?? statusColId,
          board_id: opts.boardId,
          org_id: orgId,
          value: { optionId: opts.statusOptionId },
        });
        expect(cellErr, `status cell(${opts.name})`).toBeNull();
      }
      if (opts.ownerIds) {
        const { error: cellErr } = await member.from("cell_values").insert({
          item_id: itemId,
          column_id: opts.peopleColumnId ?? peopleColId,
          board_id: opts.boardId,
          org_id: orgId,
          value: { userIds: opts.ownerIds },
        });
        expect(cellErr, `people cell(${opts.name})`).toBeNull();
      }
      if (opts.date) {
        const { error: cellErr } = await member.from("cell_values").insert({
          item_id: itemId,
          column_id: opts.dateColumnId ?? dateColId,
          board_id: opts.boardId,
          org_id: orgId,
          value: { date: opts.date },
        });
        expect(cellErr, `date cell(${opts.name})`).toBeNull();
      }
      return itemId;
    }

    async function boardColumns(id: string) {
      const { data: cols } = await member
        .from("columns")
        .select("id, kind, settings")
        .eq("board_id", id);
      return cols ?? [];
    }

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const a = await provision("member");
      member = a.anon;
      memberUserId = a.userId;
      const b = await provision("outsider");
      outsider = b.anon;

      const { data: org } = await member.rpc("create_organization", {
        p_name: "Health Org",
        p_slug: `hlt-${randomUUID().slice(0, 8)}`,
      });
      orgId = (org as { id: string }).id;

      const { data: ws } = await member
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: a.userId })
        .select("id")
        .single();
      const wsId = (ws as { id: string }).id;

      const { data: board, error: boardErr } = await member.rpc(
        "create_board",
        {
          p_workspace_id: wsId,
          p_name: "Plan A",
        },
      );
      expect(boardErr).toBeNull();
      boardId = (board as { id: string }).id;

      const { data: seededGroup } = await member
        .from("groups")
        .select("id")
        .eq("board_id", boardId)
        .single();
      groupId = (seededGroup as { id: string }).id;

      // Seeded default columns: Status + Owner (people) + Date (date).
      const cols = await boardColumns(boardId);
      const statusCol = cols.find((c) => c.kind === "status")!;
      statusColId = statusCol.id;
      peopleColId = cols.find((c) => c.kind === "people")!.id;
      dateColId = cols.find((c) => c.kind === "date")!.id;
      const options = (
        statusCol as unknown as {
          settings: { options: { id: string; label: string }[] };
        }
      ).settings.options;
      doneOptId = options.find((o) => o.label === "Done")!.id;
      wipOptId = options.find((o) => o.label !== "Done")!.id;

      const yesterday = isoDaysFromNow(-1);
      const tomorrow = isoDaysFromNow(1);

      // i-done: done + owner + past date → done; overdue suppressed by done.
      await seedItem({
        boardId,
        groupId,
        name: "i-done",
        statusOptionId: doneOptId,
        ownerIds: [memberUserId],
        date: yesterday,
      });
      // i-overdue: wip + owner + past date → overdue, not incomplete.
      await seedItem({
        boardId,
        groupId,
        name: "i-overdue",
        statusOptionId: wipOptId,
        ownerIds: [memberUserId],
        date: yesterday,
      });
      // i-no-owner: future date, no owner → incomplete (owner), not overdue.
      await seedItem({
        boardId,
        groupId,
        name: "i-no-owner",
        date: tomorrow,
      });
      // i-no-date: owner, no date → incomplete (date).
      const noDateId = await seedItem({
        boardId,
        groupId,
        name: "i-no-date",
        ownerIds: [memberUserId],
      });
      // i-sub: subitem with nothing set → excluded everywhere (top-level only).
      await seedItem({
        boardId,
        groupId,
        name: "i-sub",
        parentId: noDateId,
      });

      // Board 2: status + date only — people column removed so the owner
      // criterion is inexpressible and must be skipped.
      const { data: board2, error: board2Err } = await member.rpc(
        "create_board",
        { p_workspace_id: wsId, p_name: "Plan B" },
      );
      expect(board2Err).toBeNull();
      board2Id = (board2 as { id: string }).id;
      const { error: delErr } = await member
        .from("columns")
        .delete()
        .eq("board_id", board2Id)
        .eq("kind", "people");
      expect(delErr).toBeNull();

      const cols2 = await boardColumns(board2Id);
      const dateCol2 = cols2.find((c) => c.kind === "date")!.id;
      const { data: group2 } = await member
        .from("groups")
        .select("id")
        .eq("board_id", board2Id)
        .single();
      await seedItem({
        boardId: board2Id,
        groupId: (group2 as { id: string }).id,
        name: "b2-dated",
        date: isoDaysFromNow(1),
        dateColumnId: dateCol2,
      });
    }, 120_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("counts done/overdue/incomplete/new per the fixed rule", async () => {
      const { data, error } = await member.rpc("dashboard_health_summary", {
        p_board_id: boardId,
      });
      expect(error).toBeNull();
      expect(data?.[0]).toMatchObject({
        total_items: 4, // subitem excluded
        done_items: 1,
        overdue_items: 1, // done item's past date suppressed
        incomplete_items: 2,
        new_items: 4, // all created just now
      });
    });

    it("skips the owner criterion on a board with no people column", async () => {
      const { data, error } = await member.rpc("dashboard_health_summary", {
        p_board_id: board2Id,
      });
      expect(error).toBeNull();
      expect(data?.[0]).toMatchObject({
        total_items: 1,
        incomplete_items: 0, // owner inexpressible, date present
        overdue_items: 0,
      });
    });

    it("rejects a non-member", async () => {
      const { error } = await outsider.rpc("dashboard_health_summary", {
        p_board_id: boardId,
      });
      expect(error).not.toBeNull();
    });

    it("rejects an unknown board", async () => {
      const { error } = await member.rpc("dashboard_health_summary", {
        p_board_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(error).not.toBeNull();
    });

    it("_org_health_digest is not callable by authenticated users", async () => {
      const { error } = await member.rpc("_org_health_digest", {
        p_org_id: orgId,
        p_since: new Date(Date.now() - 7 * 864e5).toISOString(),
      });
      expect(error).not.toBeNull(); // revoked
    });

    it("digest_runs is invisible to authenticated users", async () => {
      const { data } = await member.from("digest_runs").select("id");
      expect(data ?? []).toEqual([]); // RLS enabled, zero policies
    });
  },
);
