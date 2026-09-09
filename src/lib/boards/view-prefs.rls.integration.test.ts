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
 * `board_view_prefs` holds a user's private arrangement of a board. The whole
 * security story is "your row, and only your row": there is no policy under
 * which a second user — even a co-editor of the same board in the same org —
 * can read or overwrite it. These probes pin that against the live database
 * rather than against the policy text, because the interesting failure mode is
 * a policy that reads correctly but resolves to `true` for the wrong caller.
 */
describe.skipIf(!integrationTargetReady())("RLS: board_view_prefs", () => {
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
  // Same org, and shared onto the board, so "cannot read the owner's prefs" is
  // a statement about the prefs row itself — not a side effect of not being
  // able to see the board.
  let other: { id: string; anon: SupabaseClient<Database> };
  // Different org entirely: cannot see the board, so cannot make a prefs row
  // for it.
  let outsider: { id: string; anon: SupabaseClient<Database> };

  async function makeUser(label: string) {
    const email = `viewprefs-${label}-${randomUUID()}@example.com`;
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
      p_name: "View Prefs Org",
      p_slug: `viewprefs-${randomUUID().slice(0, 8)}`,
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
      p_name: "Prefs Board",
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
      p_slug: `viewprefs-out-${randomUUID().slice(0, 8)}`,
    });
    outsider = { id: out.id, anon: out.anon };
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("stores and reads back the owner's own arrangement", async () => {
    const { error } = await owner.anon.rpc("save_board_view_prefs", {
      p_board_id: owner.boardId,
      p_state: { collapsedGroupIds: [owner.groupId] },
    });
    expect(error).toBeNull();

    const { data } = await owner.anon
      .from("board_view_prefs")
      .select("state")
      .eq("board_id", owner.boardId)
      .maybeSingle();
    expect(data?.state).toEqual({ collapsedGroupIds: [owner.groupId] });
  });

  it("a second user cannot read the first user's arrangement", async () => {
    const { data } = await other.anon
      .from("board_view_prefs")
      .select("state")
      .eq("board_id", owner.boardId);
    expect(data).toEqual([]);
  });

  it("a second user cannot overwrite the first user's row", async () => {
    // The RPC always writes auth.uid()'s own row, so this creates a SEPARATE
    // row rather than clobbering.
    const { error } = await other.anon.rpc("save_board_view_prefs", {
      p_board_id: owner.boardId,
      p_state: { collapsedGroupIds: [] },
    });
    expect(error).toBeNull();

    // The second user sees only their own, newly created row…
    const { data: mine } = await other.anon
      .from("board_view_prefs")
      .select("state")
      .eq("board_id", owner.boardId)
      .maybeSingle();
    expect(mine?.state).toEqual({ collapsedGroupIds: [] });

    // …and the owner's row is untouched.
    const { data } = await owner.anon
      .from("board_view_prefs")
      .select("state")
      .eq("board_id", owner.boardId)
      .maybeSingle();
    expect(data?.state).toEqual({ collapsedGroupIds: [owner.groupId] });

    // Two distinct rows exist for the one board — one per user.
    const { data: rows } = await admin
      .from("board_view_prefs")
      .select("user_id")
      .eq("board_id", owner.boardId);
    expect((rows ?? []).map((r) => r.user_id).sort()).toEqual(
      [owner.id, other.id].sort(),
    );
  });

  it("a non-member cannot create a row for a board they cannot see", async () => {
    const { error } = await outsider.anon.rpc("save_board_view_prefs", {
      p_board_id: owner.boardId,
      p_state: {},
    });
    expect(error).not.toBeNull();

    // Nothing was written on the outsider's behalf.
    const { data: rows } = await admin
      .from("board_view_prefs")
      .select("user_id")
      .eq("board_id", owner.boardId);
    expect((rows ?? []).some((r) => r.user_id === outsider.id)).toBe(false);
  });
});
