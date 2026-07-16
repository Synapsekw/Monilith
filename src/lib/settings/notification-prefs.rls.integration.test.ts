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
  "RLS: notification_preferences",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    async function makeUser(): Promise<{
      id: string;
      anon: SupabaseClient<Database>;
    }> {
      const email = `rls-notifpref-${randomUUID()}@example.com`;
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

    let A: { id: string; anon: SupabaseClient<Database> };
    let B: { id: string; anon: SupabaseClient<Database> };

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      A = await makeUser();
      B = await makeUser();
    });

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    });

    it("a user cannot read another user's preference rows", async () => {
      // A disables a kind for themselves.
      const ins = await A.anon.from("notification_preferences").insert({
        user_id: A.id,
        kind: "mention",
        channel: "in_app",
        enabled: false,
      });
      expect(ins.error).toBeNull();

      // B selects — must see none of A's rows.
      const { data: bSees } = await B.anon
        .from("notification_preferences")
        .select("*");
      expect((bSees ?? []).some((r) => r.user_id === A.id)).toBe(false);
    });

    it("a user cannot write a preference row for someone else", async () => {
      const { error } = await B.anon.from("notification_preferences").insert({
        user_id: A.id, // not B -> WITH CHECK must reject
        kind: "assigned",
        channel: "in_app",
        enabled: false,
      });
      expect(error).not.toBeNull();
    });
  },
);
