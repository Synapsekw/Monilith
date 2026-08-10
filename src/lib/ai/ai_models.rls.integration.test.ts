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
      expect((data ?? []).map((r) => r.id).sort()).toEqual([
        "anthropic",
        "google",
        "mistral",
        "moonshotai",
        "openai",
      ]);
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
      const { error } = await anon
        .from("ai_models")
        .update({ input_price_per_mtok: 0 })
        .eq("model_id", "claude-sonnet-5");
      // Default-deny yields either an explicit error or zero affected rows;
      // assert the price is unchanged either way.
      const { data } = await admin
        .from("ai_models")
        .select("input_price_per_mtok")
        .eq("provider", "anthropic")
        .eq("model_id", "claude-sonnet-5")
        .single();
      expect(Number(data?.input_price_per_mtok)).toBe(3);
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
