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

// dashboard_completion RPC semantics + auth contract (opt-in live-DB suite,
// decision-25: skips cleanly unless a marked test target is configured).
describe.skipIf(!integrationTargetReady())("dashboard_completion RPC", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  let member: SupabaseClient<Database>;
  let outsider: SupabaseClient<Database>;
  let orgId: string;
  let boardId: string;
  let groupAId: string;
  let groupBId: string;
  let percentColId: string;
  let statusColId: string;
  let doneOptId: string;
  let wipOptId: string;

  async function provision(label: string) {
    const email = `completion-${randomUUID()}@example.com`;
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
    groupId: string;
    name: string;
    parentId?: string;
    percent?: number;
    statusOptionId?: string;
  }): Promise<string> {
    const { data: item, error } = await member
      .from("items")
      .insert({
        board_id: boardId,
        org_id: orgId,
        group_id: opts.groupId,
        name: opts.name,
        ...(opts.parentId ? { parent_id: opts.parentId } : {}),
      })
      .select("id")
      .single();
    expect(error, `seedItem(${opts.name})`).toBeNull();
    const itemId = (item as { id: string }).id;
    if (opts.percent !== undefined) {
      const { error: cellErr } = await member.from("cell_values").insert({
        item_id: itemId,
        column_id: percentColId,
        board_id: boardId,
        org_id: orgId,
        value: { percent: opts.percent },
      });
      expect(cellErr, `percent cell(${opts.name})`).toBeNull();
    }
    if (opts.statusOptionId) {
      const { error: cellErr } = await member.from("cell_values").insert({
        item_id: itemId,
        column_id: statusColId,
        board_id: boardId,
        org_id: orgId,
        value: { optionId: opts.statusOptionId },
      });
      expect(cellErr, `status cell(${opts.name})`).toBeNull();
    }
    return itemId;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const a = await provision("member");
    member = a.anon;
    const b = await provision("outsider");
    outsider = b.anon;

    const { data: org } = await member.rpc("create_organization", {
      p_name: "Completion Org",
      p_slug: `cmp-${randomUUID().slice(0, 8)}`,
    });
    orgId = (org as { id: string }).id;

    const { data: ws } = await member
      .from("workspaces")
      .insert({ org_id: orgId, name: "WS", created_by: a.userId })
      .select("id")
      .single();

    const { data: board, error: boardErr } = await member.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: "Phase 1",
    });
    expect(boardErr).toBeNull();
    boardId = (board as { id: string }).id;

    // Seeded default group = Group A; add Group B.
    const { data: seededGroup } = await member
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .single();
    groupAId = (seededGroup as { id: string }).id;
    const { data: groupB, error: groupBErr } = await member
      .from("groups")
      .insert({ org_id: orgId, board_id: boardId, name: "WS B", position: 1 })
      .select("id")
      .single();
    expect(groupBErr).toBeNull();
    groupBId = (groupB as { id: string }).id;

    // Seeded status column + its Done / In Progress options.
    const { data: statusCol } = await member
      .from("columns")
      .select("id, settings")
      .eq("board_id", boardId)
      .eq("kind", "status")
      .single();
    statusColId = (statusCol as { id: string }).id;
    const options = (
      statusCol as unknown as {
        settings: { options: { id: string; label: string }[] };
      }
    ).settings.options;
    doneOptId = options.find((o) => o.label === "Done")!.id;
    wipOptId = options.find((o) => o.label !== "Done")!.id;

    // Add a percent column.
    const { data: percentCol, error: pcErr } = await member
      .from("columns")
      .insert({
        org_id: orgId,
        board_id: boardId,
        kind: "percent",
        name: "% Complete",
        settings: {},
        position: 10,
      })
      .select("id")
      .single();
    expect(pcErr).toBeNull();
    percentColId = (percentCol as { id: string }).id;

    // Group A: two top-level items (50%, done / 100%, wip) + one subitem
    // (percent 0) that must be excluded. Group B: one item, no cells.
    const parentId = await seedItem({
      groupId: groupAId,
      name: "A1",
      percent: 50,
      statusOptionId: doneOptId,
    });
    await seedItem({
      groupId: groupAId,
      name: "A2",
      percent: 100,
      statusOptionId: wipOptId,
    });
    await seedItem({
      groupId: groupAId,
      name: "A1.1",
      parentId,
      percent: 0,
    });
    await seedItem({ groupId: groupBId, name: "B1" });
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("percent mode: averages per group, empty cell = 0, subitems excluded", async () => {
    const { data, error } = await member.rpc("dashboard_completion", {
      p_board_id: boardId,
      p_mode: "percent",
      p_value_column_id: percentColId,
    });
    expect(error).toBeNull();
    const byGroup = new Map((data ?? []).map((r) => [r.group_key, r]));
    // (50 + 100) / 2 = 75 — the percent-0 subitem does not drag it to 50.
    expect(byGroup.get(groupAId)).toMatchObject({
      item_count: 2,
      completion: 75,
    });
    // B1 has no percent cell → counts as 0.
    expect(byGroup.get(groupBId)).toMatchObject({
      item_count: 1,
      completion: 0,
    });
  });

  it("status mode: share of items in the done set", async () => {
    const { data, error } = await member.rpc("dashboard_completion", {
      p_board_id: boardId,
      p_mode: "status",
      p_value_column_id: statusColId,
      p_done_option_ids: [doneOptId],
    });
    expect(error).toBeNull();
    const byGroup = new Map((data ?? []).map((r) => [r.group_key, r]));
    expect(Number(byGroup.get(groupAId)?.completion)).toBe(50); // 1 of 2 done
    expect(Number(byGroup.get(groupBId)?.completion)).toBe(0);
  });

  it("rejects an invalid mode", async () => {
    const { error } = await member.rpc("dashboard_completion", {
      p_board_id: boardId,
      p_mode: "bogus",
      p_value_column_id: percentColId,
    });
    expect(error).not.toBeNull();
  });

  it("denies a non-member (42501)", async () => {
    const { error } = await outsider.rpc("dashboard_completion", {
      p_board_id: boardId,
      p_mode: "percent",
      p_value_column_id: percentColId,
    });
    expect(error).not.toBeNull();
  });

  it("rejects an unknown board", async () => {
    const { error } = await member.rpc("dashboard_completion", {
      p_board_id: "00000000-0000-0000-0000-000000000000",
      p_mode: "percent",
      p_value_column_id: percentColId,
    });
    expect(error).not.toBeNull();
  });
});
