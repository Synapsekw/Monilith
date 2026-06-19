import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!SERVICE_ROLE_KEY)("provision_account", () => {
  let admin: SupabaseClient<Database>;
  let anon: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `provision-test-${randomUUID()}@example.com`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    createdUserIds.push(created.user!.id);

    anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await anon.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    expect(signInErr).toBeNull();
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("creates an org, owner membership, and a Main workspace", async () => {
    const { data: org, error } = await anon.rpc("provision_account", {
      p_org_name: "Provision Test Org",
    });
    expect(error).toBeNull();
    const orgId = (org as { id: string }).id;
    expect(orgId).toBeTruthy();

    const { data: members } = await anon
      .from("org_members")
      .select("org_id, role");
    expect(members).toHaveLength(1);
    expect((members![0] as { role: string }).role).toBe("owner");

    const { data: workspaces } = await anon
      .from("workspaces")
      .select("name, org_id");
    expect(workspaces).toHaveLength(1);
    expect((workspaces![0] as { name: string }).name).toBe("Main");
    expect((workspaces![0] as { org_id: string }).org_id).toBe(orgId);
  });

  it("is idempotent — a second call returns the same org and adds nothing", async () => {
    const { data: first } = await anon.rpc("provision_account", {
      p_org_name: "Should Be Ignored",
    });
    const firstId = (first as { id: string }).id;

    const { data: again, error } = await anon.rpc("provision_account", {
      p_org_name: "Also Ignored",
    });
    expect(error).toBeNull();
    expect((again as { id: string }).id).toBe(firstId);

    const { data: orgs } = await anon.from("organizations").select("id");
    expect(orgs).toHaveLength(1);
    const { data: workspaces } = await anon.from("workspaces").select("id");
    expect(workspaces).toHaveLength(1);
  });
});
