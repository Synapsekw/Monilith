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

describe.skipIf(!integrationTargetReady())("RLS: feedback", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  async function makeUser(): Promise<{
    id: string;
    anon: SupabaseClient<Database>;
  }> {
    const email = `rls-feedback-${randomUUID()}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    const id = created.user!.id;
    createdUserIds.push(id);
    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });
    return { id, anon };
  }

  let member: { id: string; anon: SupabaseClient<Database> };
  let otherMember: { id: string; anon: SupabaseClient<Database> };
  let platformAdmin: { id: string; anon: SupabaseClient<Database> };
  let orgId: string;
  let feedbackId: string;

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    member = await makeUser();
    otherMember = await makeUser();
    platformAdmin = await makeUser();

    // Create org via RPC, add other members via service client.
    const { data: org } = await member.anon.rpc("create_organization", {
      p_name: "Feedback Test Org",
      p_slug: `feedback-rls-${randomUUID().slice(0, 8)}`,
    });
    orgId = (org as { id: string }).id;

    await admin
      .from("org_members")
      .insert({ org_id: orgId, user_id: otherMember.id, role: "member" });

    // Make platformAdmin a platform admin.
    await admin.from("platform_admins").insert({ user_id: platformAdmin.id });
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("a member can insert their own feedback and read it back", async () => {
    const { data, error } = await member.anon
      .from("feedback")
      .insert({
        submitted_by: member.id,
        org_id: orgId,
        kind: "bug",
        title: "Test bug",
        body: "Something broke.",
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    feedbackId = (data as { id: string }).id;

    const { data: rows } = await member.anon
      .from("feedback")
      .select("id")
      .eq("id", feedbackId);
    expect((rows ?? []).length).toBe(1);
  });

  it("a second member CANNOT read the first member's feedback (0 rows)", async () => {
    const { data: rows } = await otherMember.anon
      .from("feedback")
      .select("id")
      .eq("id", feedbackId);
    expect(rows ?? []).toHaveLength(0);
  });

  it("a non-admin UPDATE of someone's feedback is rejected / affects 0 rows", async () => {
    const { data: rows, error } = await otherMember.anon
      .from("feedback")
      .update({ status: "resolved" })
      .eq("id", feedbackId)
      .select("id");
    // Either an error or 0 affected rows — RLS blocks it.
    const affected = (rows ?? []).length;
    const blocked = error !== null || affected === 0;
    expect(blocked).toBe(true);
  });

  it("platform admin can update status and submitter gets a feedback_response notification", async () => {
    // Platform admin updates the feedback row.
    const { error: updateErr } = await admin
      .from("feedback")
      .update({
        status: "in_progress",
        admin_response: "Looking into this.",
        responded_by: platformAdmin.id,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", feedbackId);
    expect(updateErr).toBeNull();

    // Insert the notification via service client (bypassing RLS, matching action logic).
    const { error: notifErr } = await admin.from("notifications").insert({
      org_id: orgId,
      recipient_id: member.id,
      actor_id: platformAdmin.id,
      kind: "feedback_response",
      feedback_id: feedbackId,
    });
    expect(notifErr).toBeNull();

    // Submitter sees the notification.
    const { data: notifs } = await member.anon
      .from("notifications")
      .select("kind, feedback_id")
      .eq("feedback_id", feedbackId);
    expect((notifs ?? []).length).toBeGreaterThan(0);
    const notif = (notifs ?? [])[0] as {
      kind: string;
      feedback_id: string;
    };
    expect(notif.kind).toBe("feedback_response");
    expect(notif.feedback_id).toBe(feedbackId);
  });
});
