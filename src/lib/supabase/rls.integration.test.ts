import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

// Load the real dev credentials. `override: true` is required because
// vitest.setup.ts seeds placeholder NEXT_PUBLIC_* values before this file's
// top-level code runs; without override dotenv would keep the placeholders.
config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PASSWORD = "Test-Password-123!";

type TestUser = {
  id: string;
  email: string;
  orgId: string;
  orgSlug: string;
  workspaceId: string;
  anon: SupabaseClient<Database>;
};

// Skips cleanly in CI (no service-role secret); runs locally against the dev project.
describe.skipIf(!SERVICE_ROLE_KEY)("RLS tenant isolation", () => {
  // Built in beforeAll, not at collection time: the describe body still runs
  // when skipped, and createClient throws on an empty URL/key.
  let admin: SupabaseClient<Database>;

  const createdUserIds: string[] = [];
  let userA: TestUser;
  let userB: TestUser;

  async function provisionUser(label: string): Promise<TestUser> {
    const email = `rls-test-${randomUUID()}@example.com`;

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
    const { error: signInErr } = await signInWithRetry(anon, {
      email,
      password: PASSWORD,
    });
    expect(signInErr, `signIn(${label})`).toBeNull();

    const orgSlug = `rls-${label}-${randomUUID().slice(0, 8)}`;
    const { data: org, error: rpcErr } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: orgSlug,
    });
    expect(rpcErr, `create_organization(${label})`).toBeNull();
    const orgId = (org as { id: string }).id;

    const { data: ws, error: wsErr } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `Workspace ${label}`, created_by: id })
      .select("id")
      .single();
    expect(wsErr, `create workspace(${label})`).toBeNull();

    return {
      id,
      email,
      orgId,
      orgSlug,
      workspaceId: (ws as { id: string }).id,
      anon,
    };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    userA = await provisionUser("a");
    userB = await provisionUser("b");
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("organizations: each user sees only their own org", async () => {
    const { data: aOrgs, error: aErr } = await userA.anon
      .from("organizations")
      .select("id");
    expect(aErr).toBeNull();
    const aIds = (aOrgs ?? []).map((r) => (r as { id: string }).id);
    expect(aIds).toEqual([userA.orgId]);
    expect(aIds).not.toContain(userB.orgId);

    const { data: bOrgs, error: bErr } = await userB.anon
      .from("organizations")
      .select("id");
    expect(bErr).toBeNull();
    const bIds = (bOrgs ?? []).map((r) => (r as { id: string }).id);
    expect(bIds).toEqual([userB.orgId]);
    expect(bIds).not.toContain(userA.orgId);
  });

  it("org_members: each user sees only their own membership", async () => {
    const { data: aMembers, error: aErr } = await userA.anon
      .from("org_members")
      .select("org_id, user_id");
    expect(aErr).toBeNull();
    expect(aMembers).toHaveLength(1);
    expect((aMembers![0] as { org_id: string }).org_id).toBe(userA.orgId);
    expect((aMembers![0] as { user_id: string }).user_id).toBe(userA.id);

    const { data: bMembers, error: bErr } = await userB.anon
      .from("org_members")
      .select("org_id, user_id");
    expect(bErr).toBeNull();
    expect(bMembers).toHaveLength(1);
    expect((bMembers![0] as { org_id: string }).org_id).toBe(userB.orgId);
  });

  it("workspaces: each user sees only their own org's workspace", async () => {
    const { data: aWs, error: aErr } = await userA.anon
      .from("workspaces")
      .select("id, org_id");
    expect(aErr).toBeNull();
    const aWsIds = (aWs ?? []).map((r) => (r as { id: string }).id);
    expect(aWsIds).toEqual([userA.workspaceId]);
    expect(aWsIds).not.toContain(userB.workspaceId);

    const { data: bWs, error: bErr } = await userB.anon
      .from("workspaces")
      .select("id, org_id");
    expect(bErr).toBeNull();
    const bWsIds = (bWs ?? []).map((r) => (r as { id: string }).id);
    expect(bWsIds).toEqual([userB.workspaceId]);
    expect(bWsIds).not.toContain(userA.workspaceId);
  });

  it("cross-tenant: targeting another tenant's org id by filter returns nothing", async () => {
    const { data, error } = await userA.anon
      .from("organizations")
      .select("id")
      .eq("id", userB.orgId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
