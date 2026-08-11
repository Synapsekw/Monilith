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
  "RLS: ai_providers / ai_models — public vendor metadata, read-only to clients",
  () => {
    let admin: SupabaseClient<Database>;
    let anon: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });
      const email = `rls-ai-models-${randomUUID()}@example.com`;
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      createdUserIds.push(created.user!.id);
      anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { persistSession: false },
      });
      await signInWithRetry(anon, { email, password: PASSWORD });
    });

    afterAll(async () => {
      for (const id of createdUserIds)
        await admin.auth.admin.deleteUser(id).catch(() => {});
    });

    it("lets a signed-in user read the seeded providers", async () => {
      const { data, error } = await anon.from("ai_providers").select("id");
      expect(error).toBeNull();
      // SUBSET, not equality. The registry is a growing table — a provider can
      // legitimately be added by a later migration, and the daily
      // `ai-models-refresh` tick is expected to change the catalog. The
      // invariant worth guarding is that the seeded floor stays readable, not
      // that the table is frozen at exactly five rows; pinning the snapshot
      // would fail this suite for a change that is working as designed.
      expect((data ?? []).map((r) => r.id)).toEqual(
        expect.arrayContaining([
          "anthropic",
          "google",
          "mistral",
          "moonshotai",
          "openai",
        ]),
      );
    });

    it("lets a signed-in user read the model catalog", async () => {
      const { data, error } = await anon
        .from("ai_models")
        .select("provider, model_id")
        .eq("status", "active");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it("denies a client insert into ai_models", async () => {
      const { error } = await anon.from("ai_models").insert({
        provider: "anthropic",
        model_id: `rogue-${randomUUID()}`,
        gateway_id: "anthropic/rogue",
        label: "Rogue",
      });
      expect(error).not.toBeNull();
    });

    it("denies a client update of a model's price", async () => {
      // Read the price FIRST rather than hard-coding today's $3/Mtok. The
      // `ai-models-refresh` cron legitimately re-prices the catalog, so the
      // security invariant is "a client cannot change this value", not "this
      // value is 3" — pinning the snapshot would break the suite for a
      // successful refresh, i.e. for the wrong reason entirely.
      const readPrice = async (): Promise<number> => {
        const { data } = await admin
          .from("ai_models")
          .select("input_price_per_mtok")
          .eq("provider", "anthropic")
          .eq("model_id", "claude-sonnet-5")
          .single();
        return Number(data?.input_price_per_mtok);
      };
      const before = await readPrice();

      const { error } = await anon
        .from("ai_models")
        .update({ input_price_per_mtok: 0 })
        .eq("model_id", "claude-sonnet-5");

      // Default-deny yields either an explicit error or zero affected rows;
      // assert the price is unchanged either way. The attempted write is 0, so
      // "still positive and finite" is itself sufficient to catch a successful
      // client update — this stays a real security assertion, not a loosened one.
      const after = await readPrice();
      expect(after).toBe(before);
      expect(Number.isFinite(after)).toBe(true);
      expect(after).toBeGreaterThan(0);
      void error;
    });

    it("denies a client insert into ai_providers", async () => {
      const { error } = await anon.from("ai_providers").insert({
        id: `rogue-${randomUUID()}`,
        label: "Rogue",
        adapter_kind: "openai-compatible",
        base_url: "https://evil.example.com/v1",
        key_placeholder: "x",
        key_format: "^x",
      });
      expect(error).not.toBeNull();
    });
  },
);
