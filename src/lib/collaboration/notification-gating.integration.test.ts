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

describe.skipIf(!integrationTargetReady())(
  "in-app notification gating trigger",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    async function makeUser(): Promise<{
      id: string;
      anon: SupabaseClient<Database>;
    }> {
      const email = `gate-notif-${randomUUID()}@example.com`;
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

    // actor = org owner; recipient = co-member. actor fans out notifications
    // to recipient (member+actor insert RLS), the trigger gates by recipient
    // preference.
    let actor: { id: string; anon: SupabaseClient<Database> };
    let recipient: { id: string; anon: SupabaseClient<Database> };
    let orgId: string;

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      actor = await makeUser();
      recipient = await makeUser();

      const { data: org } = await actor.anon.rpc("create_organization", {
        p_name: "Gate Org",
        p_slug: `gate-${randomUUID().slice(0, 8)}`,
      });
      orgId = (org as { id: string }).id;
      // Add recipient to the org directly (service role) so fan-out is allowed.
      await admin
        .from("org_members")
        .insert({ org_id: orgId, user_id: recipient.id, role: "member" });
    });

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    });

    it("drops the in-app row when the recipient disabled that kind", async () => {
      // recipient opts out of 'mention' in-app
      const optOut = await recipient.anon
        .from("notification_preferences")
        .insert({
          user_id: recipient.id,
          kind: "mention",
          channel: "in_app",
          enabled: false,
        });
      expect(optOut.error).toBeNull();

      // actor fans out a mention notification to recipient
      const ins = await actor.anon.from("notifications").insert({
        org_id: orgId,
        recipient_id: recipient.id,
        actor_id: actor.id,
        kind: "mention",
      });
      expect(ins.error).toBeNull(); // trigger returns NULL, not an error

      // recipient sees no such row (trigger skipped the insert)
      const { data } = await recipient.anon
        .from("notifications")
        .select("id")
        .eq("recipient_id", recipient.id)
        .eq("kind", "mention");
      expect(data ?? []).toHaveLength(0);
    });

    it("keeps the row when the recipient has NOT opted out", async () => {
      const ins = await actor.anon.from("notifications").insert({
        org_id: orgId,
        recipient_id: recipient.id,
        actor_id: actor.id,
        kind: "assigned",
      });
      expect(ins.error).toBeNull();

      const { data } = await recipient.anon
        .from("notifications")
        .select("id")
        .eq("recipient_id", recipient.id)
        .eq("kind", "assigned");
      expect((data ?? []).length).toBeGreaterThan(0);
    });
  },
);
