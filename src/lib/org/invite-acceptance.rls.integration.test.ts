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
const PW = "Test-Password-123!";
type Role = Database["public"]["Enums"]["org_role"];

describe.skipIf(!SERVICE_ROLE_KEY)("invite acceptance RPCs", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];
  let owner: { id: string; anon: SupabaseClient<Database> };
  let orgId: string;

  async function makeUser(email: string) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: PW,
      email_confirm: true,
    });
    expect(error).toBeNull();
    const id = created.user!.id;
    createdUserIds.push(id);
    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: sErr } = await signInWithRetry(anon, {
      email,
      password: PW,
    });
    expect(sErr).toBeNull();
    return { id, anon };
  }

  async function seedInvite(email: string, role: Role = "member") {
    const { data, error } = await admin
      .from("org_invitations")
      .insert({
        org_id: orgId,
        email,
        role,
        invited_by: owner.id,
        status: "pending",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return (data as { id: string }).id;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    owner = await makeUser(`invite-owner-${randomUUID()}@example.com`);
    const { data: org, error } = await owner.anon.rpc("create_organization", {
      p_name: "Invite Org",
      p_slug: `invite-${randomUUID().slice(0, 8)}`,
    });
    expect(error).toBeNull();
    orgId = (org as { id: string }).id;
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("my_pending_invitations returns the caller's pending invite with org name", async () => {
    const email = `invitee-${randomUUID()}@example.com`;
    await seedInvite(email);
    const invitee = await makeUser(email);
    const { data, error } = await invitee.anon.rpc("my_pending_invitations");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].org_id).toBe(orgId);
    expect(data![0].org_name).toBe("Invite Org");
    expect(data![0].role).toBe("member");
  });

  it("does not return invites addressed to a different email", async () => {
    await seedInvite(`someone-else-${randomUUID()}@example.com`);
    const stranger = await makeUser(`stranger-${randomUUID()}@example.com`);
    const { data, error } = await stranger.anon.rpc("my_pending_invitations");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("accept_invitation enrolls the caller and marks the invite accepted", async () => {
    const email = `accepter-${randomUUID()}@example.com`;
    const inviteId = await seedInvite(email, "admin");
    const invitee = await makeUser(email);
    const { data: returnedOrg, error } = await invitee.anon.rpc(
      "accept_invitation",
      {
        p_invite_id: inviteId,
      },
    );
    expect(error).toBeNull();
    expect(returnedOrg).toBe(orgId);

    const { data: membership } = await admin
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", invitee.id)
      .single();
    expect((membership as { role: Role }).role).toBe("admin");

    const { data: inv } = await admin
      .from("org_invitations")
      .select("status")
      .eq("id", inviteId)
      .single();
    expect((inv as { status: string }).status).toBe("accepted");
  });

  it("accept_invitation rejects an invite addressed to a different email", async () => {
    const inviteId = await seedInvite(`victim-${randomUUID()}@example.com`);
    const attacker = await makeUser(`attacker-${randomUUID()}@example.com`);
    const { error } = await attacker.anon.rpc("accept_invitation", {
      p_invite_id: inviteId,
    });
    expect(error).not.toBeNull();
    const { data: m } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", attacker.id)
      .maybeSingle();
    expect(m).toBeNull();
  });

  it("decline_invitation marks the invite declined", async () => {
    const email = `decliner-${randomUUID()}@example.com`;
    const inviteId = await seedInvite(email);
    const invitee = await makeUser(email);
    const { error } = await invitee.anon.rpc("decline_invitation", {
      p_invite_id: inviteId,
    });
    expect(error).toBeNull();
    const { data: inv } = await admin
      .from("org_invitations")
      .select("status")
      .eq("id", inviteId)
      .single();
    expect((inv as { status: string }).status).toBe("declined");
  });
});
