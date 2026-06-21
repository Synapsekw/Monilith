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

describe.skipIf(!SERVICE_ROLE_KEY)("RLS: board list queries", () => {
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
  let grantee: { id: string; anon: SupabaseClient<Database> };

  async function makeUser(label: string) {
    const email = `lists-${label}-${randomUUID()}@example.com`;
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
      p_name: "Lists Org",
      p_slug: `lists-${randomUUID().slice(0, 8)}`,
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
      p_name: "Owned Board",
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

    const gr = await makeUser("grantee");
    await admin
      .from("org_members")
      .insert([{ org_id: orgId, user_id: gr.id, role: "member" }]);
    grantee = { id: gr.id, anon: gr.anon };
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("owner sees own board; shared_out true once granted", async () => {
    const { data } = await owner.anon
      .from("boards")
      .select("id, name, workspace_id, position, board_members(user_id)")
      .eq("created_by", owner.id);
    expect(data?.some((b) => b.id === owner.boardId)).toBe(true);

    const before = data?.find((b) => b.id === owner.boardId);
    expect((before?.board_members ?? []).length).toBe(0);

    await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
      p_access: "viewer",
    });

    const { data: after } = await owner.anon
      .from("boards")
      .select("id, name, workspace_id, position, board_members(user_id)")
      .eq("created_by", owner.id);
    const ownedAfter = after?.find((b) => b.id === owner.boardId);
    expect((ownedAfter?.board_members ?? []).length).toBeGreaterThan(0);
  });

  it("grantee sees the board via board_members, not as creator", async () => {
    await owner.anon.rpc("share_board", {
      p_board_id: owner.boardId,
      p_user_id: grantee.id,
      p_access: "viewer",
    });
    const { data } = await grantee.anon
      .from("board_members")
      .select("board_id, access_level, boards(name, created_by)")
      .eq("user_id", grantee.id);
    expect(data?.[0]?.access_level).toBe("viewer");

    const row = data?.find((r) => r.board_id === owner.boardId);
    expect(row).toBeTruthy();
    // Boards embeds as an object on a to-one FK; the grantee is not the creator.
    const embedded = row?.boards as
      | { name: string; created_by: string }
      | { name: string; created_by: string }[]
      | null;
    const createdBy = Array.isArray(embedded)
      ? embedded[0]?.created_by
      : embedded?.created_by;
    expect(createdBy).toBe(owner.id);
    expect(createdBy).not.toBe(grantee.id);

    // The grantee is not a creator of this board.
    const { data: asCreator } = await grantee.anon
      .from("boards")
      .select("id")
      .eq("created_by", grantee.id);
    expect((asCreator ?? []).some((b) => b.id === owner.boardId)).toBe(false);
  });
});
