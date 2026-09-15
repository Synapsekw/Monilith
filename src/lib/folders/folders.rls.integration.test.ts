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
  let aAnon: SupabaseClient<Database>;
  let bAnon: SupabaseClient<Database>;
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
});
