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

const WORK_DATE = "2026-07-06";

// Write-confinement coverage for time_allocations (cross-org guard migration
// 20260709090000): the insert/update WITH CHECK confines the nullable
// item_id/board_id FKs to the row's own org, on top of the original
// is_org_member(org_id) + self-only gate.
describe.skipIf(!integrationTargetReady())("RLS: time_allocations", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // org A: user with a board + item. org B: outsider with their own board + item.
  let aAnon: SupabaseClient<Database>;
  let bAnon: SupabaseClient<Database>;
  let aId: string;
  let bId: string;
  let orgAId: string;
  let orgBId: string;
  let aBoardId: string;
  let aItemId: string;
  let bBoardId: string;
  let bItemId: string;

  async function provisionUser(label: string): Promise<{
    id: string;
    anon: SupabaseClient<Database>;
    orgId: string;
    boardId: string;
    itemId: string;
  }> {
    const email = `ta-${label}-${randomUUID()}@example.com`;
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

    const { data: org, error: orgErr } = await anon.rpc("create_organization", {
      p_name: `Org ${label} ${randomUUID().slice(0, 8)}`,
      p_slug: `ta-${label}-${randomUUID().slice(0, 8)}`,
    });
    expect(orgErr, `create_organization(${label})`).toBeNull();
    const orgId = (org as { id: string }).id;

    const { data: ws, error: wsErr } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
      .select("id")
      .single();
    expect(wsErr, `insert workspace(${label})`).toBeNull();

    const { data: board, error: boardErr } = await anon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: `Board ${label}`,
    });
    expect(boardErr, `create_board(${label})`).toBeNull();
    const boardId = (board as { id: string }).id;

    const { data: group } = await anon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .limit(1)
      .single();
    const { data: item, error: itemErr } = await anon.rpc("create_item", {
      p_group_id: (group as { id: string }).id,
      p_name: `Item ${label}`,
    });
    expect(itemErr, `create_item(${label})`).toBeNull();
    return { id, anon, orgId, boardId, itemId: (item as { id: string }).id };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const a = await provisionUser("a");
    aAnon = a.anon;
    aId = a.id;
    orgAId = a.orgId;
    aBoardId = a.boardId;
    aItemId = a.itemId;

    const b = await provisionUser("b");
    bAnon = b.anon;
    bId = b.id;
    orgBId = b.orgId;
    bBoardId = b.boardId;
    bItemId = b.itemId;
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("self can insert an item allocation and a category allocation in the own org", async () => {
    const itemRow = await aAnon.from("time_allocations").insert({
      org_id: orgAId,
      user_id: aId,
      work_date: WORK_DATE,
      item_id: aItemId,
      board_id: aBoardId,
      duration_secs: 3600,
    });
    expect(itemRow.error, "same-org item allocation").toBeNull();

    const categoryRow = await aAnon.from("time_allocations").insert({
      org_id: orgAId,
      user_id: aId,
      work_date: WORK_DATE,
      category: "admin",
      duration_secs: 1800,
    });
    expect(categoryRow.error, "category allocation").toBeNull();
  });

  it("cross-org confinement: item_id referencing another org's item is rejected", async () => {
    // Old WITH CHECK only gated is_org_member(org_id) + self — the item FK
    // could point at another org's row (cross-tenant reference).
    const { error } = await bAnon.from("time_allocations").insert({
      org_id: orgBId,
      user_id: bId,
      work_date: WORK_DATE,
      item_id: aItemId, // org A's item
      duration_secs: 600,
    });
    expect(error, "cross-org item FK must be rejected").not.toBeNull();
  });

  it("cross-org confinement: board_id referencing another org's board is rejected", async () => {
    const { error } = await bAnon.from("time_allocations").insert({
      org_id: orgBId,
      user_id: bId,
      work_date: WORK_DATE,
      item_id: bItemId,
      board_id: aBoardId, // org A's board
      duration_secs: 600,
    });
    expect(error, "cross-org board FK must be rejected").not.toBeNull();
  });

  it("update cannot repoint an allocation at another org's item", async () => {
    const { data: row, error: insErr } = await bAnon
      .from("time_allocations")
      .insert({
        org_id: orgBId,
        user_id: bId,
        work_date: WORK_DATE,
        item_id: bItemId,
        board_id: bBoardId,
        duration_secs: 900,
      })
      .select("id")
      .single();
    expect(insErr, "same-org insert (setup)").toBeNull();

    const { error } = await bAnon
      .from("time_allocations")
      .update({ item_id: aItemId, board_id: null })
      .eq("id", (row as { id: string }).id);
    expect(error, "cross-org repoint must be rejected").not.toBeNull();
  });

  it("self-only gate still holds: cannot write an allocation for another user", async () => {
    // a and b are in different orgs, so use admin to add b to org A? No —
    // simplest same-class check: A tries to log time AS someone else (bId).
    const { error } = await aAnon.from("time_allocations").insert({
      org_id: orgAId,
      user_id: bId,
      work_date: WORK_DATE,
      category: "meetings",
      duration_secs: 600,
    });
    expect(
      error,
      "writing another user's allocation must be rejected",
    ).not.toBeNull();
  });
});
