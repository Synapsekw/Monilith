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

const PW = "Test-Password-123!";

type Role = Database["public"]["Enums"]["org_role"];

type TestUser = {
  id: string;
  email: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!SERVICE_ROLE_KEY)("platform-admin gate + RPCs", () => {
  let admin: SupabaseClient<Database>;

  const createdUserIds: string[] = [];

  let platformAdmin: TestUser; // seeded into platform_admins
  let normalUser: TestUser; // not a platform admin
  let target: TestUser; // member to be promoted in another org
  let orgId: string; // org owned by `target`, managed cross-tenant

  async function createUser(label: string): Promise<TestUser> {
    const email = `platform-${label}-${randomUUID()}@example.com`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: PW,
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
      password: PW,
    });
    expect(signInErr, `signIn(${label})`).toBeNull();

    return { id, email, anon };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    platformAdmin = await createUser("admin");
    normalUser = await createUser("normal");
    target = await createUser("target");

    // `target` self-provisions an org (owner). The platform admin will assign an
    // org admin in THIS org — a different org from the platform admin's own.
    const slug = `platform-${randomUUID().slice(0, 8)}`;
    const { data: org, error: orgErr } = await target.anon.rpc(
      "create_organization",
      { p_name: "Target Org", p_slug: slug },
    );
    expect(orgErr, "create_organization(target)").toBeNull();
    orgId = (org as { id: string }).id;

    // Seed the platform_admins row via service client (setup; bypasses RLS,
    // which is correct — platform_admins is never client-writable).
    const { error: seedErr } = await admin
      .from("platform_admins")
      .insert({ user_id: platformAdmin.id });
    expect(seedErr, "seed platform_admins row").toBeNull();
  }, 120_000);

  afterAll(async () => {
    // Deleting the users cascades the platform_admins / org_members rows.
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("gate fails closed for a normal user", async () => {
    // platform_set_org_role errors for a non-platform user.
    const { error } = await normalUser.anon.rpc("platform_set_org_role", {
      p_org_id: orgId,
      p_user_id: normalUser.id,
      p_role: "admin" as Role,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/not authorized/);

    // is_platform_admin() returns false for them.
    const { data: isAdmin, error: gateErr } =
      await normalUser.anon.rpc("is_platform_admin");
    expect(gateErr).toBeNull();
    expect(isAdmin).toBe(false);
  });

  it("platform admin assigns an org admin in another org", async () => {
    // Sanity: the gate is true for the platform admin.
    const { data: isAdmin } = await platformAdmin.anon.rpc("is_platform_admin");
    expect(isAdmin).toBe(true);

    // Assign `normalUser` as an admin in the target org (the platform admin is
    // NOT a member of that org — cross-tenant).
    const { error } = await platformAdmin.anon.rpc("platform_set_org_role", {
      p_org_id: orgId,
      p_user_id: normalUser.id,
      p_role: "admin" as Role,
    });
    expect(error).toBeNull();

    // org_members reflects it.
    const { data: membership } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", normalUser.id)
      .single();
    expect((membership as { role: Role }).role).toBe("admin");

    // An org_admin.assigned audit row exists with actor_kind='platform'.
    const { data: auditRows } = await admin
      .from("admin_audit_log")
      .select("action, actor_kind, actor_id, org_id")
      .eq("org_id", orgId)
      .eq("action", "org_admin.assigned")
      .eq("target_user_id", normalUser.id);
    expect((auditRows ?? []).length).toBeGreaterThan(0);
    const row = (auditRows ?? [])[0] as {
      actor_kind: string;
      actor_id: string;
    };
    expect(row.actor_kind).toBe("platform");
    expect(row.actor_id).toBe(platformAdmin.id);
  });

  it("platform audit visibility: org-null rows visible to platform admin, hidden from others", async () => {
    // Seed a platform-scoped (org_id is null) audit row via service client.
    // These rows are produced by platform user (de)activation actions; here we
    // seed one directly as test setup (not via an RPC under test).
    const { error: seedErr } = await admin.from("admin_audit_log").insert({
      org_id: null,
      actor_id: platformAdmin.id,
      actor_kind: "platform",
      action: "platform.user_deactivated",
      target_user_id: normalUser.id,
    });
    expect(seedErr).toBeNull();

    // Platform admin sees org_id is null rows.
    const { data: adminSees, error: adminErr } = await platformAdmin.anon
      .from("admin_audit_log")
      .select("id")
      .is("org_id", null)
      .eq("action", "platform.user_deactivated")
      .eq("target_user_id", normalUser.id);
    expect(adminErr).toBeNull();
    expect((adminSees ?? []).length).toBeGreaterThan(0);

    // A normal user sees 0 of those rows.
    const { data: normalSees, error: normalErr } = await normalUser.anon
      .from("admin_audit_log")
      .select("id")
      .is("org_id", null);
    expect(normalErr).toBeNull();
    expect(normalSees ?? []).toEqual([]);
  });

  it("platform_stats fails closed for a normal user", async () => {
    const { data, error } = await normalUser.anon.rpc("platform_stats");
    expect(error).toBeNull();
    // SECURITY DEFINER fn gated by is_platform_admin(): zero rows, not an error.
    expect(data ?? []).toEqual([]);
  });

  it("platform_stats returns a single counts row for a platform admin", async () => {
    const { data, error } = await platformAdmin.anon.rpc("platform_stats");
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);

    const row = (data ?? [])[0]!;
    // Don't hard-code totals — the shared dev project has other data. There is
    // at least the seeded admin's org, the created users, and the seeded admin.
    expect(typeof row.orgs).toBe("number");
    expect(typeof row.users).toBe("number");
    expect(typeof row.admins).toBe("number");
    expect(typeof row.events_24h).toBe("number");
    expect(row.orgs).toBeGreaterThanOrEqual(1);
    expect(row.users).toBeGreaterThanOrEqual(1);
    expect(row.admins).toBeGreaterThanOrEqual(1);
    expect(row.events_24h).toBeGreaterThanOrEqual(0);
  });

  it("platform_search_users fails closed for a normal user", async () => {
    const { data, error } = await normalUser.anon.rpc("platform_search_users", {
      p_query: "",
      p_limit: 25,
      p_offset: 0,
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("platform_search_users finds the seeded admin and honors limit/offset", async () => {
    // The platform admin's email is `platform-admin-<uuid>@example.com`; use a
    // distinctive substring (the full local part) so we match exactly that user.
    const queryFragment = platformAdmin.email.split("@")[0]!;
    const { data, error } = await platformAdmin.anon.rpc(
      "platform_search_users",
      { p_query: queryFragment, p_limit: 25, p_offset: 0 },
    );
    expect(error).toBeNull();

    const rows = data ?? [];
    const match = rows.find((r) => r.id === platformAdmin.id);
    expect(
      match,
      "seeded platform admin should be in search results",
    ).toBeDefined();
    expect(match!.email).toBe(platformAdmin.email);
    // The platform admin self-provisioned no org here, but org_names must be a
    // (possibly empty) array, never null.
    expect(Array.isArray(match!.org_names)).toBe(true);

    // limit is honored: limit 1 returns at most 1 row.
    const { data: limited, error: limitErr } = await platformAdmin.anon.rpc(
      "platform_search_users",
      { p_query: "", p_limit: 1, p_offset: 0 },
    );
    expect(limitErr).toBeNull();
    expect((limited ?? []).length).toBeLessThanOrEqual(1);
  });

  it("platform_search_users returns org_names for a user with org membership", async () => {
    // `normalUser` was made an admin in `orgId` ("Target Org") by an earlier
    // test; searching their email must surface that org in org_names.
    const queryFragment = normalUser.email.split("@")[0]!;
    const { data, error } = await platformAdmin.anon.rpc(
      "platform_search_users",
      { p_query: queryFragment, p_limit: 25, p_offset: 0 },
    );
    expect(error).toBeNull();

    const match = (data ?? []).find((r) => r.id === normalUser.id);
    expect(
      match,
      "normalUser should be found by email substring",
    ).toBeDefined();
    expect(match!.email).toBe(normalUser.email);
    expect(match!.org_names).toContain("Target Org");
  });
});
