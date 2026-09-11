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
 * `board_visits` holds a user's own "last had this board open" stamp. The
 * whole security story is "your row, and only your row, on a board you can
 * read": there is no policy under which a second user — even a co-editor of
 * the same board in the same org — can read another user's visit row, and no
 * user can stamp a visit on a board they cannot read. These probes pin that
 * against the live database rather than against the policy text, because the
 * interesting failure mode is a policy that reads correctly but resolves to
 * `true` for the wrong caller.
 */
describe.skipIf(!integrationTargetReady())("RLS: board_visits", () => {
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
    const email = `boardvisits-${label}-${randomUUID()}@example.com`;
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
      p_name: "Board Visits Org",
      p_slug: `boardvisits-${randomUUID().slice(0, 8)}`,
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
      p_name: "Visits Board",
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
      p_slug: `boardvisits-out-${randomUUID().slice(0, 8)}`,
    });
    outsider = { id: out.id, anon: out.anon };
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("stamps and reads back the owner's own visit", async () => {
    const { error } = await owner.anon.rpc("touch_board_visit", {
      p_board_id: owner.boardId,
    });
    expect(error).toBeNull();
    const { data } = await owner.anon
      .from("board_visits")
      .select("last_seen_at")
      .eq("board_id", owner.boardId)
      .maybeSingle();
    expect(typeof data?.last_seen_at).toBe("string");
  });

  it("a second stamp updates the same row (one row per user per board)", async () => {
    const before = await owner.anon
      .from("board_visits")
      .select("last_seen_at")
      .eq("board_id", owner.boardId)
      .maybeSingle();
    await new Promise((r) => setTimeout(r, 20));
    await owner.anon.rpc("touch_board_visit", { p_board_id: owner.boardId });
    const { data: rows } = await owner.anon
      .from("board_visits")
      .select("last_seen_at")
      .eq("board_id", owner.boardId);
    expect(rows).toHaveLength(1);
    expect(rows![0].last_seen_at > before.data!.last_seen_at).toBe(true);
  });

  it("a shared editor cannot read the owner's visit but can stamp their own", async () => {
    const { data } = await other.anon
      .from("board_visits")
      .select("last_seen_at")
      .eq("board_id", owner.boardId);
    expect(data).toEqual([]);
    const { error } = await other.anon.rpc("touch_board_visit", {
      p_board_id: owner.boardId,
    });
    expect(error).toBeNull();
    const { data: mine } = await other.anon
      .from("board_visits")
      .select("user_id")
      .eq("board_id", owner.boardId);
    expect(mine).toEqual([{ user_id: other.id }]);
  });

  it("an outsider (other org) cannot stamp a visit on a board they cannot read", async () => {
    const { error } = await outsider.anon.rpc("touch_board_visit", {
      p_board_id: owner.boardId,
    });
    expect(error).not.toBeNull();
    const { data } = await admin
      .from("board_visits")
      .select("user_id")
      .eq("board_id", owner.boardId)
      .eq("user_id", outsider.id);
    expect(data).toEqual([]);
  });
});
