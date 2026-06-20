import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// Skips cleanly in CI (no service-role secret); runs locally against the dev project.
describe.skipIf(!SERVICE_ROLE_KEY)("admin RLS + RPCs", () => {
  // Built in beforeAll, not at collection time: the describe body still runs
  // when skipped, and createClient throws on an empty URL/key.
  let admin: SupabaseClient<Database>;

  const createdUserIds: string[] = [];

  // owner + admin + member all live in ONE org. The owner self-provisions the
  // org via create_organization (proven RPC); admin/member are added by direct
  // service-role inserts into org_members (setup only — bypasses RLS, never the
  // RPC under test).
  let owner: TestUser;
  let adminUser: TestUser;
  let member: TestUser;
  let other: TestUser; // user in a DIFFERENT org
  let orgId: string;
  let boardId: string;

  // Build only the auth user + signed-in anon client (no org).
  async function createUser(label: string): Promise<TestUser> {
    const email = `admin-rls-${label}-${randomUUID()}@example.com`;
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
    const { error: signInErr } = await anon.auth.signInWithPassword({
      email,
      password: PW,
    });
    expect(signInErr, `signIn(${label})`).toBeNull();

    return { id, email, anon };
  }

  // Owner self-provisions an org and a board (so deactivation can be observed
  // against real org data).
  async function provisionOrg(
    u: TestUser,
    label: string,
  ): Promise<{ orgId: string; boardId: string }> {
    const slug = `admin-rls-${label}-${randomUUID().slice(0, 8)}`;
    const { data: org, error: orgErr } = await u.anon.rpc(
      "create_organization",
      { p_name: `Org ${label}`, p_slug: slug },
    );
    expect(orgErr, `create_organization(${label})`).toBeNull();
    const oId = (org as { id: string }).id;

    const { data: ws, error: wsErr } = await u.anon
      .from("workspaces")
      .insert({ org_id: oId, name: `WS ${label}`, created_by: u.id })
      .select("id")
      .single();
    expect(wsErr, `create workspace(${label})`).toBeNull();

    const { data: board, error: boardErr } = await u.anon
      .from("boards")
      .insert({
        org_id: oId,
        workspace_id: (ws as { id: string }).id,
        name: `Board ${label}`,
        created_by: u.id,
      })
      .select("id")
      .single();
    expect(boardErr, `create board(${label})`).toBeNull();

    return { orgId: oId, boardId: (board as { id: string }).id };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    owner = await createUser("owner");
    adminUser = await createUser("admin");
    member = await createUser("member");
    other = await createUser("other");

    // Owner self-provisions the shared org (and a board for deactivation tests).
    const provisioned = await provisionOrg(owner, "main");
    orgId = provisioned.orgId;
    boardId = provisioned.boardId;

    // Other user gets their own separate org (used to prove cross-org isolation
    // via `other.anon`).
    await provisionOrg(other, "other");

    // Seed admin + member into the shared org via the service client (setup
    // bypass; not the RPC under test). Both default to active (deactivated_at
    // null).
    const { error: seedErr } = await admin.from("org_members").insert([
      { org_id: orgId, user_id: adminUser.id, role: "admin" as Role },
      { org_id: orgId, user_id: member.id, role: "member" as Role },
    ]);
    expect(seedErr, "seed admin + member rows").toBeNull();
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("admin cannot change an owner's role", async () => {
    const { error } = await adminUser.anon.rpc("set_member_role", {
      p_org_id: orgId,
      p_user_id: owner.id,
      p_new_role: "member" as Role,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(
      /admins cannot manage owners or admins/,
    );

    // Owner's role is unchanged.
    const { data } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", owner.id)
      .single();
    expect((data as { role: Role }).role).toBe("owner");
  });

  it("owner promotes a member to admin (succeeds; row updated)", async () => {
    const { error } = await owner.anon.rpc("set_member_role", {
      p_org_id: orgId,
      p_user_id: member.id,
      p_new_role: "admin" as Role,
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", member.id)
      .single();
    expect((data as { role: Role }).role).toBe("admin");

    // Restore member to `member` for later cases that rely on the member role.
    const { error: restoreErr } = await owner.anon.rpc("set_member_role", {
      p_org_id: orgId,
      p_user_id: member.id,
      p_new_role: "member" as Role,
    });
    expect(restoreErr).toBeNull();
  });

  it("last-owner demote is blocked", async () => {
    const { error } = await owner.anon.rpc("set_member_role", {
      p_org_id: orgId,
      p_user_id: owner.id,
      p_new_role: "member" as Role,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/cannot demote the last owner/);
  });

  it("last-owner remove is blocked", async () => {
    const { error } = await owner.anon.rpc("remove_member", {
      p_org_id: orgId,
      p_user_id: owner.id,
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/cannot remove the last owner/);
  });

  it("last-owner guard counts only ACTIVE owners (deactivated owner is ignored)", async () => {
    // Setup: a SECOND owner exists but is deactivated. Before the fix the guard
    // counted both owners (count=2) and wrongly allowed demoting/removing the
    // remaining active owner, leaving the org with zero usable owners.
    const secondOwner = await createUser("second-owner");
    const { error: seedErr } = await admin.from("org_members").insert({
      org_id: orgId,
      user_id: secondOwner.id,
      role: "owner" as Role,
    });
    expect(seedErr, "seed second owner").toBeNull();

    // Deactivate the second owner via the RPC under test (owner is the actor).
    const { error: deErr } = await owner.anon.rpc("deactivate_member", {
      p_org_id: orgId,
      p_user_id: secondOwner.id,
    });
    expect(deErr).toBeNull();

    // Sanity: the second owner is indeed deactivated.
    const { data: soRow } = await admin
      .from("org_members")
      .select("deactivated_at")
      .eq("org_id", orgId)
      .eq("user_id", secondOwner.id)
      .single();
    expect(
      (soRow as { deactivated_at: string | null }).deactivated_at,
    ).not.toBeNull();

    // Demoting the remaining ACTIVE owner must be blocked (only 1 active owner).
    const { error: demoteErr } = await owner.anon.rpc("set_member_role", {
      p_org_id: orgId,
      p_user_id: owner.id,
      p_new_role: "member" as Role,
    });
    expect(demoteErr).not.toBeNull();
    expect(demoteErr?.message ?? "").toMatch(/cannot demote the last owner/);

    // Removing the remaining ACTIVE owner must be blocked too.
    const { error: removeErr } = await owner.anon.rpc("remove_member", {
      p_org_id: orgId,
      p_user_id: owner.id,
    });
    expect(removeErr).not.toBeNull();
    expect(removeErr?.message ?? "").toMatch(/cannot remove the last owner/);

    // The active owner's role is intact.
    const { data: ownerRow } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", owner.id)
      .single();
    expect((ownerRow as { role: Role }).role).toBe("owner");

    // Cleanup: remove the deactivated second owner so it doesn't perturb later
    // owner-count-sensitive cases (service-role delete; not the RPC under test).
    const { error: cleanupErr } = await admin
      .from("org_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", secondOwner.id);
    expect(cleanupErr).toBeNull();
  });

  it("deactivated member is denied org data; reactivation restores it", async () => {
    // Baseline: active member sees their org + board.
    const { data: orgsBefore } = await member.anon
      .from("organizations")
      .select("id")
      .eq("id", orgId);
    expect((orgsBefore ?? []).map((r) => (r as { id: string }).id)).toEqual([
      orgId,
    ]);
    const { data: boardsBefore } = await member.anon
      .from("boards")
      .select("id")
      .eq("id", boardId);
    expect((boardsBefore ?? []).length).toBe(1);

    // Owner deactivates the member via the RPC under test.
    const { error: deErr } = await owner.anon.rpc("deactivate_member", {
      p_org_id: orgId,
      p_user_id: member.id,
    });
    expect(deErr).toBeNull();

    // Helper-function behavior: deactivated member is denied that org's data.
    const { data: orgsAfter } = await member.anon
      .from("organizations")
      .select("id")
      .eq("id", orgId);
    expect(orgsAfter ?? []).toEqual([]);
    const { data: boardsAfter } = await member.anon
      .from("boards")
      .select("id")
      .eq("id", boardId);
    expect(boardsAfter ?? []).toEqual([]);

    // Reactivate: access returns.
    const { error: reErr } = await owner.anon.rpc("reactivate_member", {
      p_org_id: orgId,
      p_user_id: member.id,
    });
    expect(reErr).toBeNull();

    const { data: orgsBack } = await member.anon
      .from("organizations")
      .select("id")
      .eq("id", orgId);
    expect((orgsBack ?? []).map((r) => (r as { id: string }).id)).toEqual([
      orgId,
    ]);
  });

  it("invitations visibility per role", async () => {
    // Seed a pending invite via the service client (setup; not an RPC test).
    const inviteEmail = `invitee-${randomUUID()}@example.com`;
    const { error: seedErr } = await admin.from("org_invitations").insert({
      org_id: orgId,
      email: inviteEmail,
      role: "member" as Role,
      invited_by: owner.id,
      status: "pending",
    });
    expect(seedErr).toBeNull();

    // Admin (owner/admin) sees the org's invites.
    const { data: adminSees, error: adminErr } = await adminUser.anon
      .from("org_invitations")
      .select("id, email")
      .eq("org_id", orgId);
    expect(adminErr).toBeNull();
    expect(
      (adminSees ?? []).map((r) => (r as { email: string }).email),
    ).toContain(inviteEmail);

    // Plain member sees 0.
    const { data: memberSees, error: memberErr } = await member.anon
      .from("org_invitations")
      .select("id")
      .eq("org_id", orgId);
    expect(memberErr).toBeNull();
    expect(memberSees ?? []).toEqual([]);

    // Other-org user sees 0.
    const { data: otherSees, error: otherErr } = await other.anon
      .from("org_invitations")
      .select("id")
      .eq("org_id", orgId);
    expect(otherErr).toBeNull();
    expect(otherSees ?? []).toEqual([]);
  });

  it("audit is append-only and visible to admins", async () => {
    // A role change writes an admin_audit_log row.
    const { error: roleErr } = await owner.anon.rpc("set_member_role", {
      p_org_id: orgId,
      p_user_id: member.id,
      p_new_role: "guest" as Role,
    });
    expect(roleErr).toBeNull();

    // Admin can see the audit row for the org.
    const { data: auditRows, error: auditErr } = await adminUser.anon
      .from("admin_audit_log")
      .select("id, action, target_user_id, actor_kind")
      .eq("org_id", orgId)
      .eq("action", "member.role_changed")
      .eq("target_user_id", member.id);
    expect(auditErr).toBeNull();
    expect((auditRows ?? []).length).toBeGreaterThan(0);
    expect(
      (auditRows ?? []).every(
        (r) => (r as { actor_kind: string }).actor_kind === "org",
      ),
    ).toBe(true);

    // Restore member role.
    await owner.anon.rpc("set_member_role", {
      p_org_id: orgId,
      p_user_id: member.id,
      p_new_role: "member" as Role,
    });

    const existing = (auditRows ?? [])[0] as { id: string } | undefined;

    // Direct client insert is blocked by RLS.
    const { error: insertErr } = await adminUser.anon
      .from("admin_audit_log")
      .insert({
        org_id: orgId,
        actor_id: adminUser.id,
        actor_kind: "org",
        action: "member.role_changed",
      });
    expect(insertErr).not.toBeNull();

    // Direct client update is blocked (append-only).
    if (existing) {
      const { error: updateErr } = await adminUser.anon
        .from("admin_audit_log")
        .update({ action: "tampered" })
        .eq("id", existing.id);
      // Update is denied: either an explicit error, or 0 rows affected (RLS
      // hides the row from the update). Verify the row is unchanged below.
      const { data: afterUpdate } = await admin
        .from("admin_audit_log")
        .select("action")
        .eq("id", existing.id)
        .single();
      expect((afterUpdate as { action: string }).action).toBe(
        "member.role_changed",
      );
      void updateErr;

      // Direct client delete is blocked (append-only).
      await adminUser.anon
        .from("admin_audit_log")
        .delete()
        .eq("id", existing.id);
      const { data: afterDelete } = await admin
        .from("admin_audit_log")
        .select("id")
        .eq("id", existing.id)
        .single();
      expect((afterDelete as { id: string }).id).toBe(existing.id);
    }
  });

  it("redeem_invitations binds the invited role and marks the invite accepted", async () => {
    // Seed a pending invite (role member) for a FRESH email via service client.
    const newEmail = `redeem-${randomUUID()}@example.com`;
    const { data: invite, error: seedErr } = await admin
      .from("org_invitations")
      .insert({
        org_id: orgId,
        email: newEmail,
        role: "member" as Role,
        invited_by: owner.id,
        status: "pending",
      })
      .select("id")
      .single();
    expect(seedErr).toBeNull();
    const inviteId = (invite as { id: string }).id;

    // Create + sign in that user.
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email: newEmail,
        password: PW,
        email_confirm: true,
      });
    expect(createErr).toBeNull();
    const newUserId = created.user!.id;
    createdUserIds.push(newUserId);

    const newAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await newAnon.auth.signInWithPassword({
      email: newEmail,
      password: PW,
    });
    expect(signInErr).toBeNull();

    // Calling redeem_invitations() returns 1.
    const { data: redeemed, error: redeemErr } =
      await newAnon.rpc("redeem_invitations");
    expect(redeemErr).toBeNull();
    expect(redeemed).toBe(1);

    // An org_members row exists with role member.
    const { data: membership } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", newUserId)
      .single();
    expect((membership as { role: Role }).role).toBe("member");

    // The invite is marked accepted.
    const { data: inviteAfter } = await admin
      .from("org_invitations")
      .select("status, accepted_at")
      .eq("id", inviteId)
      .single();
    expect((inviteAfter as { status: string }).status).toBe("accepted");
    expect(
      (inviteAfter as { accepted_at: string | null }).accepted_at,
    ).not.toBeNull();
  });
});
