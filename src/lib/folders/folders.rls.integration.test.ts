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

describe.skipIf(!integrationTargetReady())("RLS: shared folders", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // A: own org, two workspaces, a board in each. B: a separate org.
  // C: a plain member of A's org with NO access to aBoardWs1 (not its creator,
  // no board_members grant) — boards are private-by-default, so org membership
  // alone must not leak folder_boards rows for a board C cannot read.
  let aAnon: SupabaseClient<Database>;
  let bAnon: SupabaseClient<Database>;
  let cAnon: SupabaseClient<Database>;
  let aUserId: string;
  let aOrgId: string;
  let aWs1: string;
  let aWs2: string;
  let aBoardWs1: string;
  let aBoardWs2: string;
  let aFolderId: string;
  let bUserId: string;
  let bOrgId: string;
  let bWs: string;
  let bBoardId: string;
  let bFolderId: string;
  let cUserId: string;

  async function provisionUser(label: string) {
    const email = `sf-${label}-${randomUUID()}@example.com`;
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
    const { data: org, error: orgErr } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `sf-${label}-${randomUUID().slice(0, 8)}`,
    });
    expect(orgErr, `create_organization(${label})`).toBeNull();
    return { id, anon, orgId: (org as { id: string }).id };
  }

  async function provisionWorkspace(
    anon: SupabaseClient<Database>,
    orgId: string,
    userId: string,
    label: string,
  ) {
    const { data: ws, error } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: userId })
      .select("id")
      .single();
    expect(error, `workspace(${label})`).toBeNull();
    return (ws as { id: string }).id;
  }

  async function provisionBoard(
    anon: SupabaseClient<Database>,
    workspaceId: string,
    label: string,
  ) {
    const { data: board, error } = await anon.rpc("create_board", {
      p_workspace_id: workspaceId,
      p_name: `Board ${label}`,
    });
    expect(error, `create_board(${label})`).toBeNull();
    return (board as { id: string }).id;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const a = await provisionUser("a");
    aAnon = a.anon;
    aUserId = a.id;
    aOrgId = a.orgId;
    aWs1 = await provisionWorkspace(aAnon, aOrgId, aUserId, "A1");
    aWs2 = await provisionWorkspace(aAnon, aOrgId, aUserId, "A2");
    aBoardWs1 = await provisionBoard(aAnon, aWs1, "A1");
    aBoardWs2 = await provisionBoard(aAnon, aWs2, "A2");

    const b = await provisionUser("b");
    bAnon = b.anon;
    bUserId = b.id;
    bOrgId = b.orgId;
    bWs = await provisionWorkspace(bAnon, bOrgId, bUserId, "B");
    bBoardId = await provisionBoard(bAnon, bWs, "B");
    const { data: bFolder, error: bFolderErr } = await bAnon
      .from("folders")
      .insert({
        org_id: bOrgId,
        workspace_id: bWs,
        name: "B Folder",
        created_by: bUserId,
      })
      .select("id")
      .single();
    expect(bFolderErr, "folder(b)").toBeNull();
    bFolderId = (bFolder as { id: string }).id;

    // C: plain member of A's org, added directly (service role) so C has no
    // creator/board_members grant on any of A's boards.
    const cEmail = `sf-c-${randomUUID()}@example.com`;
    const { data: cCreated, error: cCreateErr } =
      await admin.auth.admin.createUser({
        email: cEmail,
        password: PASSWORD,
        email_confirm: true,
      });
    expect(cCreateErr, "createUser(c)").toBeNull();
    cUserId = cCreated.user!.id;
    createdUserIds.push(cUserId);
    const { error: cMemberErr } = await admin
      .from("org_members")
      .insert({ org_id: aOrgId, user_id: cUserId, role: "member" });
    expect(cMemberErr, "org_members(c)").toBeNull();
    cAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(cAnon, { email: cEmail, password: PASSWORD });
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("lets an org member create a folder in their own workspace", async () => {
    const { data, error } = await aAnon
      .from("folders")
      .insert({
        org_id: aOrgId,
        workspace_id: aWs1,
        name: "Q4 Launch",
        created_by: aUserId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    aFolderId = (data as { id: string }).id;
  });

  it("rejects a folder whose workspace belongs to another org", async () => {
    const { error } = await bAnon.from("folders").insert({
      org_id: bOrgId,
      workspace_id: aWs1, // A's workspace
      name: "Sneaky",
      created_by: bUserId,
    });
    expect(error?.code).toBe("42501");
  });

  it("rejects a second folder with the same name in the same workspace", async () => {
    const { error } = await aAnon.from("folders").insert({
      org_id: aOrgId,
      workspace_id: aWs1,
      name: "  q4 launch ",
      created_by: aUserId,
    });
    expect(error?.code).toBe("23505");
  });

  it("refuses to move a folder to another workspace or org (23514)", async () => {
    // A folder's `folder_boards` placements are workspace-scoped and its
    // dashboards hang off a composite (org_id, folder_id) FK, so a tenancy
    // move orphans both. Nothing in the product moves a folder — the
    // `folders_block_tenant_move` trigger is a hard stop, not a cascade.
    const moved = await aAnon
      .from("folders")
      .update({ workspace_id: aWs2 })
      .eq("id", aFolderId);
    expect(moved.error?.code).toBe("23514");

    const reOrged = await aAnon
      .from("folders")
      .update({ org_id: bOrgId })
      .eq("id", aFolderId);
    // Either the trigger (23514) or the org RLS/FK stops this; what must never
    // happen is a successful cross-org move.
    expect(reOrged.error).not.toBeNull();

    // Renaming — the folder mutation the product actually has — still works.
    const renamed = await aAnon
      .from("folders")
      .update({ name: "Q4 Launch (renamed)" })
      .eq("id", aFolderId);
    expect(renamed.error).toBeNull();
    const restored = await aAnon
      .from("folders")
      .update({ name: "Q4 Launch" })
      .eq("id", aFolderId);
    expect(restored.error).toBeNull();
  });

  it("hides another org's folders", async () => {
    const { data } = await bAnon
      .from("folders")
      .select("id")
      .eq("id", aFolderId);
    expect(data ?? []).toHaveLength(0);
  });

  it("lets a member file a readable board from the folder's workspace", async () => {
    const { error } = await aAnon
      .from("folder_boards")
      .insert({ folder_id: aFolderId, board_id: aBoardWs1 });
    expect(error).toBeNull();
  });

  it("lets the board's own org member (with board access) see its folder_boards row", async () => {
    const { data } = await aAnon
      .from("folder_boards")
      .select("board_id")
      .eq("folder_id", aFolderId)
      .eq("board_id", aBoardWs1);
    expect(data ?? []).toHaveLength(1);
  });

  it("hides a folder_boards row for a board the caller cannot read, even as an org member", async () => {
    const { data } = await cAnon
      .from("folder_boards")
      .select("board_id")
      .eq("folder_id", aFolderId)
      .eq("board_id", aBoardWs1);
    expect(data ?? []).toHaveLength(0);
  });

  it("does not let an org member without board access delete that folder_boards row", async () => {
    await cAnon
      .from("folder_boards")
      .delete()
      .eq("folder_id", aFolderId)
      .eq("board_id", aBoardWs1);
    // RLS silently filters the row out of the DELETE's USING clause rather
    // than erroring, so the only observable effect is: nothing changed.
    const { data } = await admin
      .from("folder_boards")
      .select("board_id")
      .eq("folder_id", aFolderId)
      .eq("board_id", aBoardWs1);
    expect(data ?? []).toHaveLength(1);
  });

  it("rejects filing a board from a different workspace", async () => {
    const { error } = await aAnon
      .from("folder_boards")
      .insert({ folder_id: aFolderId, board_id: aBoardWs2 });
    expect(error?.code).toBe("42501");
  });

  it("rejects filing a board the caller cannot read", async () => {
    const { error } = await aAnon
      .from("folder_boards")
      .insert({ folder_id: aFolderId, board_id: bBoardId });
    expect(error?.code).toBe("42501");
  });

  it("rejects a non-member writing into the folder", async () => {
    const { error } = await bAnon
      .from("folder_boards")
      .insert({ folder_id: aFolderId, board_id: bBoardId });
    expect(error?.code).toBe("42501");
  });

  it("enforces one folder per board via the primary key", async () => {
    const { data: second } = await aAnon
      .from("folders")
      .insert({
        org_id: aOrgId,
        workspace_id: aWs1,
        name: "Second",
        created_by: aUserId,
      })
      .select("id")
      .single();
    const { error } = await aAnon.from("folder_boards").insert({
      folder_id: (second as { id: string }).id,
      board_id: aBoardWs1,
    });
    expect(error?.code).toBe("23505");
  });

  it("cascades: deleting the folder removes placements and nulls dashboards.folder_id", async () => {
    const { data: dash } = await aAnon.rpc("create_dashboard", {
      p_workspace_id: aWs1,
      p_name: "D",
    });
    const dashId = (dash as { id: string }).id;
    const { error: attachErr } = await aAnon
      .from("dashboards")
      .update({ folder_id: aFolderId })
      .eq("id", dashId);
    expect(attachErr).toBeNull();

    await aAnon.from("folders").delete().eq("id", aFolderId);

    const { data: placements } = await admin
      .from("folder_boards")
      .select("board_id")
      .eq("folder_id", aFolderId);
    expect(placements ?? []).toHaveLength(0);
    const { data: d } = await admin
      .from("dashboards")
      .select("folder_id")
      .eq("id", dashId)
      .single();
    expect(d?.folder_id).toBeNull();
    const { data: boards } = await admin
      .from("boards")
      .select("id")
      .eq("id", aBoardWs1);
    expect(boards ?? []).toHaveLength(1);
  });

  it("rejects moving a dashboard into another org's folder (composite FK)", async () => {
    const { data: dash } = await aAnon.rpc("create_dashboard", {
      p_workspace_id: aWs1,
      p_name: "Cross-org move",
    });
    const dashId = (dash as { id: string }).id;
    const { error } = await aAnon
      .from("dashboards")
      .update({ folder_id: bFolderId }) // B's folder, A's dashboard
      .eq("id", dashId);
    expect(error?.code).toBe("23503");
  });
});
