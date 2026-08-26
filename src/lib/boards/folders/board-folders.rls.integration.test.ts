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

describe.skipIf(!integrationTargetReady())("RLS: board folders", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // user A: creator of their own board + a private folder.
  // user B: a separate org, unrelated to A — neither creator nor board member
  // of A's board, and vice versa.
  let aAnon: SupabaseClient<Database>;
  let bAnon: SupabaseClient<Database>;
  let aUserId: string;
  let aBoardId: string;
  let aBoard2Id: string;
  let aFolderId: string;
  let bBoardId: string;

  async function provisionUser(label: string): Promise<{
    id: string;
    anon: SupabaseClient<Database>;
    orgId: string;
  }> {
    const email = `bf-${label}-${randomUUID()}@example.com`;
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
      p_slug: `bf-${label}-${randomUUID().slice(0, 8)}`,
    });
    expect(orgErr, `create_organization(${label})`).toBeNull();
    return { id, anon, orgId: (org as { id: string }).id };
  }

  async function provisionBoard(
    anon: SupabaseClient<Database>,
    orgId: string,
    userId: string,
    label: string,
  ): Promise<string> {
    const { data: ws, error: wsErr } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: userId })
      .select("id")
      .single();
    expect(wsErr, `insert workspace(${label})`).toBeNull();
    const { data: board, error: boardErr } = await anon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: `Board ${label}`,
    });
    expect(boardErr, `create_board(${label})`).toBeNull();
    return (board as { id: string }).id;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // -- user A: own org + two own boards + a private folder --
    const a = await provisionUser("a");
    aAnon = a.anon;
    aUserId = a.id;
    aBoardId = await provisionBoard(aAnon, a.orgId, a.id, "A");
    aBoard2Id = await provisionBoard(aAnon, a.orgId, a.id, "A2");

    const { data: folder, error: folderErr } = await aAnon
      .from("board_folders")
      .insert({ user_id: aUserId, name: "A's folder" })
      .select("id")
      .single();
    expect(folderErr, "insert board_folders(A)").toBeNull();
    aFolderId = (folder as { id: string }).id;

    // Seed an existing placement (aBoardId inside aFolderId) directly via the
    // admin/service-role client: this test isn't probing the insert-time
    // can_read_board gate (that's exercised by the accept/reject tests below),
    // it needs a real row already in place before the cascade test deletes
    // the folder and asserts the placement disappears with it.
    const { error: placementErr } = await admin
      .from("board_folder_boards")
      .insert({ user_id: aUserId, board_id: aBoardId, folder_id: aFolderId });
    expect(placementErr, "seed board_folder_boards(A, aBoardId)").toBeNull();

    // -- user B: a separate org with its own board; A is neither creator nor
    //    a board_members grantee, so can_read_board(bBoardId) must be false
    //    for A.
    const b = await provisionUser("b");
    bAnon = b.anon;
    bBoardId = await provisionBoard(bAnon, b.orgId, b.id, "B");
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("hides one user's folders from another user", async () => {
    const { data } = await bAnon
      .from("board_folders")
      .select("id")
      .eq("id", aFolderId);
    expect(data ?? []).toHaveLength(0);
  });

  it("rejects filing a board the user cannot read", async () => {
    // bBoardId belongs to user B's org; user A is neither creator nor board member.
    const { error } = await aAnon.from("board_folder_boards").insert({
      user_id: aUserId,
      board_id: bBoardId,
      folder_id: aFolderId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501"); // RLS violation
  });

  it("allows filing a board the user can read", async () => {
    // aBoard2Id is A's own board — can_read_board(aBoard2Id) is true for A, so
    // the insert-time gate must permit it. Uses a second board (not aBoardId)
    // so it doesn't collide with the placement seeded in beforeAll or get
    // deleted early by the cascade test below.
    const { error } = await aAnon.from("board_folder_boards").insert({
      user_id: aUserId,
      board_id: aBoard2Id,
      folder_id: aFolderId,
    });
    expect(error).toBeNull();
  });

  it("cascades: deleting the folder removes its placements but leaves the boards intact", async () => {
    await aAnon.from("board_folders").delete().eq("id", aFolderId);

    // Queried via the admin client so RLS can't mask a placement row that
    // survived the cascade — this is what actually proves
    // `folder_id ... on delete cascade` fired, not just that the (already-
    // invisible-once-the-folder-is-gone) row can't be read back.
    const { data: placements } = await admin
      .from("board_folder_boards")
      .select("board_id")
      .eq("folder_id", aFolderId);
    expect(placements ?? []).toHaveLength(0);

    const { data: boards } = await admin
      .from("boards")
      .select("id")
      .eq("id", aBoardId);
    expect(boards ?? []).toHaveLength(1);
  });
});
