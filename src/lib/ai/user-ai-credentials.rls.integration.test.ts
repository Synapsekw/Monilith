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

type TestUser = {
  id: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!integrationTargetReady())(
  "RLS: user_ai_credentials boundary — no client read/write of secrets, tenant isolation",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];
    let userA: TestUser;
    let userB: TestUser;

    async function provisionUser(label: string): Promise<TestUser> {
      const email = `rls-ai-cred-${randomUUID()}@example.com`;
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
      await signInWithRetry(anon, { email, password: PASSWORD });

      return { id, anon };
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

    it("the authenticated client cannot INSERT into user_ai_credentials directly (no insert policy)", async () => {
      const { error } = await userA.anon.from("user_ai_credentials").insert({
        user_id: userA.id,
        provider: "anthropic",
        secret_id: randomUUID(),
        key_hint: "sk-ant-…FAKE",
      });
      expect(error).not.toBeNull();
    });

    it("user B cannot see user A's stored credential row (tenant isolation), and user A's own read is metadata-only", async () => {
      const { error: setErr } = await admin.rpc("ai_credential_set", {
        p_user: userA.id,
        p_provider: "anthropic",
        p_secret: "sk-ant-super-secret-value",
        p_hint: "sk-ant-…ALUE",
      });
      expect(setErr).toBeNull();

      // User B must see zero rows for user A's credential.
      const { data: bSees, error: bErr } = await userB.anon
        .from("user_ai_credentials")
        .select("*")
        .eq("user_id", userA.id);
      expect(bErr).toBeNull();
      expect(bSees).toEqual([]);

      // User A's own authenticated read returns only the metadata columns —
      // there is no plaintext-key column to leak, and the hint is masked.
      const { data: aSees, error: aErr } = await userA.anon
        .from("user_ai_credentials")
        .select("provider, key_hint")
        .eq("user_id", userA.id);
      expect(aErr).toBeNull();
      expect(aSees).toEqual([
        { provider: "anthropic", key_hint: "sk-ant-…ALUE" },
      ]);
      expect(JSON.stringify(aSees)).not.toContain("super-secret-value");
    });

    it("the authenticated client cannot call ai_credential_get (execute revoked)", async () => {
      const { error } = await userA.anon.rpc("ai_credential_get", {
        p_user: userA.id,
        p_provider: "anthropic",
      });
      expect(error).not.toBeNull();
    });

    it("keeps one key PER PROVIDER — saving a second does not clear the first", async () => {
      const svc = admin;
      await svc.rpc("ai_credential_set", {
        p_user: userA.id,
        p_provider: "anthropic",
        p_secret: "sk-ant-test-key-aaaa",
        p_hint: "sk-ant-…aaaa",
      });
      await svc.rpc("ai_credential_set", {
        p_user: userA.id,
        p_provider: "moonshotai",
        p_secret: "sk-kimi-test-key-bbbb",
        p_hint: "sk-kimi…bbbb",
      });

      const { data } = await svc
        .from("user_ai_credentials")
        .select("provider")
        .eq("user_id", userA.id);
      expect((data ?? []).map((r) => r.provider).sort()).toEqual([
        "anthropic",
        "moonshotai",
      ]);
    });

    it("deletes only the named provider's key", async () => {
      await admin.rpc("ai_credential_delete", {
        p_user: userA.id,
        p_provider: "moonshotai",
      });
      const { data } = await admin
        .from("user_ai_credentials")
        .select("provider")
        .eq("user_id", userA.id);
      expect((data ?? []).map((r) => r.provider)).toEqual(["anthropic"]);
    });

    it("resolves a specific provider's secret, not an arbitrary one", async () => {
      const { data } = await admin.rpc("ai_credential_get", {
        p_user: userA.id,
        p_provider: "anthropic",
      });
      expect(data?.[0]?.provider).toBe("anthropic");

      const { data: none } = await admin.rpc("ai_credential_get", {
        p_user: userA.id,
        p_provider: "moonshotai",
      });
      expect(none ?? []).toHaveLength(0);
    });
  },
);
