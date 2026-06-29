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

const CONTENT_TABLES = [
  "groups",
  "items",
  "columns",
  "cell_values",
  "board_views",
] as const;

describe.skipIf(!integrationTargetReady())("RLS: board-level sharing", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  let owner: {
    id: string;
    orgId: string;
    workspaceId: string;
    boardId: string;
    groupId: string;
    itemId: string;
    anon: SupabaseClient<Database>;
  };
  let outsider: { id: string; anon: SupabaseClient<Database> };
  let grantee: { id: string; anon: SupabaseClient<Database> };

  async function makeUser(label: string) {
    const email = `share-${label}-${randomUUID()}@example.com`;
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
      p_name: "Share Org",
      p_slug: `share-${randomUUID().slice(0, 8)}`,
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
    owner = {
      id: o.id,
      orgId,
      workspaceId,
      boardId,
      groupId,
      itemId,
      anon: o.anon,
    };

    const out = await makeUser("outsider");
    const gr = await makeUser("grantee");
    await admin.from("org_members").insert([
      { org_id: orgId, user_id: out.id, role: "member" },
      { org_id: orgId, user_id: gr.id, role: "member" },
    ]);
    outsider = { id: out.id, anon: out.anon };
    grantee = { id: gr.id, anon: gr.anon };
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("a same-org member NOT granted cannot read a private board or its content", async () => {
    const { data: b } = await outsider.anon
      .from("boards")
      .select("*")
      .eq("id", owner.boardId);
    expect(b, "boards").toEqual([]);
    for (const t of CONTENT_TABLES) {
      const { data } = await outsider.anon
        .from(t)
        .select("*")
        .eq("board_id", owner.boardId);
      expect(data, `read ${t}`).toEqual([]);
    }
  });

  it("the owner can read their own private board", async () => {
    const { data } = await owner.anon
      .from("boards")
      .select("id")
      .eq("id", owner.boardId);
    expect(data).toHaveLength(1);
  });

  it("share_board(viewer) lets the grantee READ but not WRITE", async () => {
    const { error: shareErr } = await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
      p_access: "viewer",
    });
    expect(shareErr).toBeNull();

    const { data: b } = await grantee.anon
      .from("boards")
      .select("id")
      .eq("id", owner.boardId);
    expect(b, "viewer can read board").toHaveLength(1);

    const { data: grp } = await grantee.anon
      .from("groups")
      .insert({ org_id: owner.orgId, board_id: owner.boardId, name: "nope" })
      .select("id");
    expect(grp ?? [], "viewer insert group").toEqual([]);

    const denied = await grantee.anon.rpc("create_item", {
      p_group_id: owner.groupId,
      p_name: "nope",
    });
    expect(denied.error, "viewer create_item RPC").not.toBeNull();
  });

  it("setting the grant to editor lets the grantee WRITE", async () => {
    const { error } = await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
      p_access: "editor",
    });
    expect(error).toBeNull();
    const { data, error: rpcErr } = await grantee.anon.rpc("create_item", {
      p_group_id: owner.groupId,
      p_name: "by editor",
    });
    expect(rpcErr).toBeNull();
    expect(data).toBeTruthy();
  });

  it("unshare_board removes all access again", async () => {
    const { error } = await owner.anon.rpc("unshare_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
    });
    expect(error).toBeNull();
    const { data } = await grantee.anon
      .from("boards")
      .select("id")
      .eq("id", owner.boardId);
    expect(data).toEqual([]);
  });

  it("a non-owner cannot share someone else's board", async () => {
    const { error } = await outsider.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: outsider.id,
      p_access: "editor",
    });
    expect(error).not.toBeNull();
  });

  it("cannot grant to a user outside the org", async () => {
    const alien = await makeUser("alien");
    const { error } = await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: alien.id,
      p_access: "viewer",
    });
    expect(error).not.toBeNull();
  });

  it("only the owner can delete the board (granted editor cannot)", async () => {
    await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
      p_access: "editor",
    });
    await grantee.anon.from("boards").delete().eq("id", owner.boardId);
    const { data: still } = await owner.anon
      .from("boards")
      .select("id")
      .eq("id", owner.boardId);
    expect(still, "board survives editor delete attempt").toHaveLength(1);
    await owner.anon.rpc("unshare_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
    });
  });
});
