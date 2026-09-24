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

describe.skipIf(!integrationTargetReady())("RLS: folder layouts", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // A: own org, one workspace, one folder. B: a separate org, one folder.
  let aAnon: SupabaseClient<Database>;
  let bAnon: SupabaseClient<Database>;
  let aUserId: string;
  let aOrgId: string;
  let aWs: string;
  let aFolderId: string;
  let bUserId: string;
  let bOrgId: string;
  let bWs: string;
  let bFolderId: string;

  async function provisionUser(label: string) {
    const email = `fl-${label}-${randomUUID()}@example.com`;
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
      p_slug: `fl-${label}-${randomUUID().slice(0, 8)}`,
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

  async function provisionFolder(
    anon: SupabaseClient<Database>,
    orgId: string,
    workspaceId: string,
    userId: string,
    label: string,
  ) {
    const { data: folder, error } = await anon
      .from("folders")
      .insert({
        org_id: orgId,
        workspace_id: workspaceId,
        name: `Folder ${label}`,
        created_by: userId,
      })
      .select("id")
      .single();
    expect(error, `folder(${label})`).toBeNull();
    return (folder as { id: string }).id;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const a = await provisionUser("a");
    aAnon = a.anon;
    aUserId = a.id;
    aOrgId = a.orgId;
    aWs = await provisionWorkspace(aAnon, aOrgId, aUserId, "A");
    aFolderId = await provisionFolder(aAnon, aOrgId, aWs, aUserId, "A");

    const b = await provisionUser("b");
    bAnon = b.anon;
    bUserId = b.id;
    bOrgId = b.orgId;
    bWs = await provisionWorkspace(bAnon, bOrgId, bUserId, "B");
    bFolderId = await provisionFolder(bAnon, bOrgId, bWs, bUserId, "B");
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("a member can insert and read their org's layout", async () => {
    const { error } = await aAnon.from("folder_layouts").insert({
      folder_id: aFolderId,
      org_id: aOrgId,
      preset: "crm",
      config: {
        v: 1,
        tabs: [
          { id: "overview", label: "Overview", kind: "canvas", sections: [] },
        ],
      },
    });
    expect(error).toBeNull();
    const { data } = await aAnon
      .from("folder_layouts")
      .select("folder_id, preset")
      .eq("folder_id", aFolderId);
    expect(data).toEqual([{ folder_id: aFolderId, preset: "crm" }]);
  });

  it("another org cannot read or write that layout", async () => {
    const { data } = await bAnon
      .from("folder_layouts")
      .select("folder_id")
      .eq("folder_id", aFolderId);
    expect(data).toEqual([]);

    const { error } = await bAnon
      .from("folder_layouts")
      .update({ preset: "blank" })
      .eq("folder_id", aFolderId);
    // Cross-tenant update is invisible, not an error: zero rows match.
    expect(error).toBeNull();
    const { data: after } = await aAnon
      .from("folder_layouts")
      .select("preset")
      .eq("folder_id", aFolderId);
    expect(after?.[0]?.preset).toBe("crm");
  });

  it("a member cannot claim a folder that belongs to another org", async () => {
    const { error } = await aAnon.from("folder_layouts").insert({
      folder_id: bFolderId,
      org_id: aOrgId,
      config: { v: 1, tabs: [] },
    });
    // 42501 is specifically "new row violates row-level security policy". A
    // bare non-null assertion would also pass if the insert merely tripped a
    // check/fk constraint, which would prove nothing about tenant isolation.
    expect(error?.code).toBe("42501");
  });

  it("deleting the folder cascades the layout away", async () => {
    await aAnon.from("folders").delete().eq("id", aFolderId);
    const { data } = await admin
      .from("folder_layouts")
      .select("folder_id")
      .eq("folder_id", aFolderId);
    expect(data).toEqual([]);
  });
});
