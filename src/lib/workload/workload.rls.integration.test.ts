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

const FROM = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
const TO = new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10);
const SEED_DATE = new Date(Date.now() + 1 * 86_400_000)
  .toISOString()
  .slice(0, 10); // tomorrow, in window

describe.skipIf(!SERVICE_ROLE_KEY)("RLS + rollup: workload", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  let aAnon: SupabaseClient<Database>; // org A owner (board creator)
  let aMember: SupabaseClient<Database>; // org A plain member, NOT a board member
  let bAnon: SupabaseClient<Database>; // org B outsider
  let orgAId: string;
  let aOwnerId: string;
  let aMemberId: string;
  let seededBoardId: string;
  let seededItemId: string;
  let seededTtColumnId: string;

  // Provision a user who owns their own fresh org (used for org A owner + org B outsider).
  async function provisionUser(label: string): Promise<{
    id: string;
    anon: SupabaseClient<Database>;
    orgId: string;
  }> {
    const email = `wl-${label}-${randomUUID()}@example.com`;
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
      p_slug: `wl-${label}-${randomUUID().slice(0, 8)}`,
    });
    expect(orgErr, `create_organization(${label})`).toBeNull();
    return { id, anon, orgId: (org as { id: string }).id };
  }

  // Provision a bare user (no org of their own); caller adds them to an existing org.
  async function provisionBareUser(label: string): Promise<{
    id: string;
    anon: SupabaseClient<Database>;
  }> {
    const email = `wl-${label}-${randomUUID()}@example.com`;
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
    return { id, anon };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // -- org A owner (board creator) --
    const a = await provisionUser("a");
    aAnon = a.anon;
    orgAId = a.orgId;
    aOwnerId = a.id;

    // -- org A plain member (added to org A, but NOT granted the board) --
    const m = await provisionBareUser("m");
    aMember = m.anon;
    aMemberId = m.id;
    const { error: addMemberErr } = await admin
      .from("org_members")
      .insert({ org_id: orgAId, user_id: aMemberId, role: "member" });
    expect(addMemberErr, "add aMember to org A").toBeNull();

    // -- a board with a Date + People + time_tracking column --
    const { data: ws, error: wsErr } = await aAnon
      .from("workspaces")
      .insert({ org_id: orgAId, name: "WS A", created_by: aOwnerId })
      .select("id")
      .single();
    expect(wsErr, "insert workspace").toBeNull();

    const { data: board, error: boardErr } = await aAnon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: "Launch",
    });
    expect(boardErr, "create_board").toBeNull();
    seededBoardId = (board as { id: string }).id;

    // create_board already seeds a 'date' column ("Date", pos 2) and a 'people'
    // column ("Owner", pos 1). The rollup resolves the board's FIRST date column,
    // so write the date cell on that seeded column (not a second one). Discover them.
    const { data: dateCol, error: dateColErr } = await aAnon
      .from("columns")
      .select("id")
      .eq("board_id", seededBoardId)
      .eq("kind", "date")
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .single();
    expect(dateColErr, "find seeded date column").toBeNull();
    const dateColumnId = (dateCol as { id: string }).id;

    const { data: peopleCol, error: peopleColErr } = await aAnon
      .from("columns")
      .select("id")
      .eq("board_id", seededBoardId)
      .eq("kind", "people")
      .order("position", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .single();
    expect(peopleColErr, "find seeded people column").toBeNull();
    const peopleColumnId = (peopleCol as { id: string }).id;

    const { data: ttCol, error: ttColErr } = await aAnon
      .from("columns")
      .insert({
        org_id: orgAId,
        board_id: seededBoardId,
        name: "Time",
        kind: "time_tracking",
        settings: {},
        position: 70,
      })
      .select("id")
      .single();
    expect(ttColErr, "insert time_tracking column").toBeNull();
    const ttColumnId = (ttCol as { id: string }).id;
    seededTtColumnId = ttColumnId;

    // -- one dated, assigned, estimated item --
    const { data: group } = await aAnon
      .from("groups")
      .select("id")
      .eq("board_id", seededBoardId)
      .limit(1)
      .single();

    const { data: item, error: itemErr } = await aAnon.rpc("create_item", {
      p_group_id: (group as { id: string }).id,
      p_name: "assigned-item",
    });
    expect(itemErr, "create_item").toBeNull();
    seededItemId = (item as { id: string }).id;

    const cells = [
      { column_id: dateColumnId, value: { date: SEED_DATE } },
      { column_id: peopleColumnId, value: { userIds: [aOwnerId] } },
      { column_id: ttColumnId, value: { estimateSeconds: 8 * 3600 } },
    ];
    for (const c of cells) {
      const { error } = await aAnon.from("cell_values").upsert({
        org_id: orgAId,
        board_id: seededBoardId,
        item_id: seededItemId,
        column_id: c.column_id,
        value: c.value,
      });
      expect(error, `cell ${c.column_id}`).toBeNull();
    }

    // -- logged time on the item: one COMPLETED entry (counts) + one RUNNING (excluded) --
    const { error: doneErr } = await aAnon.from("time_entries").insert({
      org_id: orgAId,
      board_id: seededBoardId,
      item_id: seededItemId,
      column_id: seededTtColumnId,
      user_id: aOwnerId,
      started_at: `${SEED_DATE}T09:00:00Z`,
      ended_at: `${SEED_DATE}T10:00:00Z`,
      duration_secs: 3600,
    });
    expect(doneErr, "insert completed time entry").toBeNull();

    const { error: runErr } = await aAnon.from("time_entries").insert({
      org_id: orgAId,
      board_id: seededBoardId,
      item_id: seededItemId,
      column_id: seededTtColumnId,
      user_id: aOwnerId,
      started_at: `${SEED_DATE}T11:00:00Z`,
      ended_at: null,
      duration_secs: null,
    });
    expect(runErr, "insert running time entry").toBeNull();

    // -- outsider in a separate org B --
    const b = await provisionUser("b");
    bAnon = b.anon;
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("workload_rollup returns the assigned dated item for the org owner (board creator)", async () => {
    const { data, error } = await aAnon.rpc("workload_rollup", {
      p_from: FROM,
      p_to: TO,
    });
    expect(error).toBeNull();
    expect(
      (data ?? []).some(
        (r) => r.item_id === seededItemId && r.user_id === aOwnerId,
      ),
    ).toBe(true);
    // estimate is carried through as seconds
    const row = (data ?? []).find((r) => r.item_id === seededItemId);
    expect(row && Number(row.estimate_secs)).toBe(8 * 3600);
  });

  it("cross-org isolation: org B's rollup does not see org A's seeded item", async () => {
    const { data } = await bAnon.rpc("workload_rollup", {
      p_from: FROM,
      p_to: TO,
    });
    expect((data ?? []).every((r) => r.item_id !== seededItemId)).toBe(true);
  });

  it("can_read_board gating: a same-org member who can't read the board gets no credit", async () => {
    const { data } = await aMember.rpc("workload_rollup", {
      p_from: FROM,
      p_to: TO,
    });
    expect((data ?? []).every((r) => r.item_id !== seededItemId)).toBe(true);
  });

  it("workload_actuals_rollup returns completed logged time for the board creator, excluding the running timer", async () => {
    const { data, error } = await aAnon.rpc("workload_actuals_rollup", {
      p_from: FROM,
      p_to: TO,
    });
    expect(error).toBeNull();
    const rows = (data ?? []).filter(
      (r) => r.user_id === aOwnerId && r.board_id === seededBoardId,
    );
    // exactly one (user, board, day) bucket: the completed 3600s entry.
    // The running timer (ended_at null) must NOT contribute.
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe(SEED_DATE);
    expect(Number(rows[0].secs)).toBe(3600);
  });

  it("actuals cross-org isolation: org B does not see org A's logged time", async () => {
    const { data } = await bAnon.rpc("workload_actuals_rollup", {
      p_from: FROM,
      p_to: TO,
    });
    expect((data ?? []).every((r) => r.board_id !== seededBoardId)).toBe(true);
  });

  it("actuals can_read_board gating: a same-org member who can't read the board sees none of its actuals", async () => {
    const { data } = await aMember.rpc("workload_actuals_rollup", {
      p_from: FROM,
      p_to: TO,
    });
    expect((data ?? []).every((r) => r.board_id !== seededBoardId)).toBe(true);
  });

  it("capacity edit: self can upsert, but cannot edit another member's row", async () => {
    const ins = await aMember.from("member_capacity").upsert(
      {
        org_id: orgAId,
        user_id: aMemberId,
        hours_per_day: 6,
        working_days: [1, 2, 3, 4, 5],
        created_by: aMemberId,
      },
      { onConflict: "org_id,user_id" },
    );
    expect(ins.error).toBeNull(); // self-edit allowed

    const bad = await aMember.from("member_capacity").upsert(
      {
        org_id: orgAId,
        user_id: aOwnerId,
        hours_per_day: 1,
        working_days: [1],
        created_by: aMemberId,
      },
      { onConflict: "org_id,user_id" },
    );
    expect(bad.error).not.toBeNull(); // editing someone else's capacity is RLS-denied
  });
});
